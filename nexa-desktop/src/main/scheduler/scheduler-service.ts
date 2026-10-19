/**
 * 定时任务调度服务 (M5)
 *
 * 设计：
 * - 每 20s tick 一次，从 SQLite 读取 enabled 且 next_run_at <= now 的任务（天然热加载）
 * - 三种 handler: script / skill / session_continuation（由 hooks 注入，避免与 runtime 循环依赖）
 * - 执行记录写 job_runs，scheduled_jobs 推进 next_run_at
 * - 长任务不阻塞 tick（异步执行 + running Set 防重入）
 * - 完成/失败发送桌面通知（notifier 由 index.ts 注入）
 */
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Database, ScheduledJob } from "../db/types"
import { computeNextRunSeconds } from "./cron"

const TICK_INTERVAL_MS = 20_000
const MAX_OUTPUT = 2000

export interface SchedulerHooks {
  /** 执行脚本（Node 子进程，ELECTRON_RUN_AS_NODE），返回 stdout */
  runScript(scriptPath: string, args?: string[]): Promise<string>
  /** 调用 Skill，返回结果文本 */
  runSkill(skillName: string, inputs: Record<string, unknown>): Promise<string>
  /** 续跑会话，返回助手回复文本 */
  continueSession(sessionId: string, prompt: string): Promise<string>
  /** 重建一个空会话（不启动 Agent Loop），返回新会话 id —— 目标会话被删除时用于自愈 */
  recreateSession(description: string): string
}

/** dispatch 结果：输出文本 + 本次运行关联的会话（无会话的 handler 为 null） */
interface DispatchResult {
  output: string
  sessionId: string | null
}

export interface JobNotifyPayload {
  success: boolean
  description: string
  output: string
}

function truncate(text: string, max = MAX_OUTPUT): string {
  const t = text.trim()
  return t.length > max ? t.slice(0, max) + "\n…（输出已截断）" : t
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()
  /** 正被定时任务续跑的会话 id（用于与「任务完成」桌面通知去重） */
  private activeSessionIds = new Set<string>()

  constructor(
    private db: Database,
    private hooks: SchedulerHooks,
    private notifier?: (payload: JobNotifyPayload) => void,
  ) {}

  /** 启动调度器（app whenReady 后） */
  start(): void {
    if (this.timer) return
    // 启动时修正所有启用任务的 next_run_at（应用关闭期间错过的任务：若 next_run 已过则在首次 tick 触发）
    for (const job of this.db.scheduledJob.listEnabled()) {
      if (job.next_run_at == null) {
        const next = computeNextRunSeconds(job.cron_expr)
        if (next != null) this.db.scheduledJob.setEnabled(job.id, 1, next)
      }
    }
    this.timer = setInterval(() => {
      void this.tick().catch(() => {})
    }, TICK_INTERVAL_MS)
    // unref 避免阻止进程退出
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 该会话是否正由定时任务执行（run.finished 时跳过「任务完成」通知，避免与定时任务通知重复） */
  isSessionRunning(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId)
  }

  /** 面板"立即执行一次"：记录执行但不推进计划时间 */
  async runNow(jobId: string): Promise<void> {
    const job = this.db.scheduledJob.get(jobId)
    if (!job) throw new Error("定时任务不存在")
    if (this.running.has(jobId)) throw new Error("任务正在执行中")
    await this.executeJob(job, { manual: true })
  }

  private async tick(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000)
    const jobs = this.db.scheduledJob.listEnabled()
    for (const job of jobs) {
      if (this.running.has(job.id)) continue
      if (job.next_run_at != null && job.next_run_at <= nowSec) {
        void this.executeJob(job, { manual: false }).catch(() => {})
      }
    }
  }

  private async executeJob(job: ScheduledJob, opts: { manual: boolean }): Promise<void> {
    this.running.add(job.id)
    const startedAt = Math.floor(Date.now() / 1000)
    const runId = this.db.jobRun.start(job.id)

    // 先推进计划时间，避免长任务执行期间被 tick 重复触发
    let nextRun: number | null = null
    if (!opts.manual) {
      nextRun = computeNextRunSeconds(job.cron_expr)
      if (nextRun == null) {
        // cron 解析失败：停用任务，防止每 20s 重试
        this.db.scheduledJob.setEnabled(job.id, 0, null)
      }
    }

    let success = false
    let output = ""
    let runSessionId: string | null = null
    try {
      const result = await this.dispatch(job)
      output = truncate(result.output)
      runSessionId = result.sessionId
      success = true
    } catch (err) {
      output = truncate(err instanceof Error ? err.message : String(err))
      success = false
      // 失败也尽量补上会话关联（可能已自愈重建，重新读 handler_config）
      if (job.handler_type === "session_continuation") {
        const latest = this.db.scheduledJob.get(job.id)
        const cfg = (latest?.handler_config ?? {}) as Record<string, unknown>
        runSessionId = typeof cfg.sessionId === "string" && cfg.sessionId ? cfg.sessionId : null
      }
    }

    const finishedAt = Math.floor(Date.now() / 1000)
    this.db.jobRun.complete(runId, success, output, undefined, runSessionId)
    if (opts.manual) {
      // 立即执行：只更新 last_run_at / last_result，保留原 next_run_at
      const existing = this.db.scheduledJob.get(job.id)
      this.db.scheduledJob.recordRun(job.id, startedAt, output, existing?.next_run_at ?? null)
    } else {
      this.db.scheduledJob.recordRun(job.id, startedAt, output, nextRun)
    }

    this.notifier?.({ success, description: job.description, output })
    this.running.delete(job.id)
  }

  private async dispatch(job: ScheduledJob): Promise<DispatchResult> {
    const cfg = job.handler_config ?? {}
    switch (job.handler_type) {
      case "script": {
        const scriptPath = String(cfg.scriptPath ?? "")
        if (!scriptPath) throw new Error("handler_config.scriptPath 缺失")
        const args = Array.isArray(cfg.args) ? cfg.args.map(String) : []
        return { output: await this.hooks.runScript(scriptPath, args), sessionId: null }
      }
      case "skill": {
        const skillName = String(cfg.skillName ?? "")
        if (!skillName) throw new Error("handler_config.skillName 缺失")
        const inputs = (cfg.inputs ?? {}) as Record<string, unknown>
        return { output: await this.hooks.runSkill(skillName, inputs), sessionId: null }
      }
      case "session_continuation": {
        let sessionId = String(cfg.sessionId ?? "")
        const prompt = String(cfg.prompt ?? "")
        if (!sessionId || !prompt) throw new Error("handler_config.sessionId / prompt 缺失")
        // 会话已被删除：自动重建空会话并写回 handler_config（自愈，后续运行复用新会话）
        if (!this.db.session.get(sessionId)) {
          sessionId = this.hooks.recreateSession(job.description)
          this.db.scheduledJob.updateHandlerConfig(job.id, { ...cfg, sessionId })
        }
        this.activeSessionIds.add(sessionId)
        try {
          return { output: await this.hooks.continueSession(sessionId, prompt), sessionId }
        } finally {
          this.activeSessionIds.delete(sessionId)
        }
      }
      default:
        throw new Error(`未知 handler_type: ${job.handler_type}`)
    }
  }
}

/** 默认脚本执行：ELECTRON_RUN_AS_NODE 子进程，cwd 为 ~/.nexa/jobs */
export function runNodeScript(scriptPath: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const jobsDir = join(homedir(), ".nexa", "jobs")
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      cwd: jobsDir,
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error("脚本执行超时（10 分钟）"))
    }, 10 * 60 * 1000)
    child.stdout.on("data", (d) => { stdout += d.toString() })
    child.stderr.on("data", (d) => { stderr += d.toString() })
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout || "(脚本无输出)")
      } else {
        reject(new Error(`脚本退出码 ${code}\n${stderr.slice(-1000) || stdout.slice(-1000)}`))
      }
    })
  })
}
