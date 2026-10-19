/**
 * 定时任务 Agent 工具 (M5)
 * schedule_create / schedule_list / schedule_toggle / schedule_delete / schedule_run_now
 * 对话式 cron：自然语言时间由 LLM 解析为 cron 表达式
 */
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { Database, ScheduledJob, ScheduledJobCreateInput } from "../db/types"
import { parseScheduleToCron, computeNextRunSeconds } from "../scheduler/cron"

const HANDLER_TYPES = ["session_continuation", "skill", "script"] as const

function formatJob(job: ScheduledJob): string {
  const lines = [
    `- [${job.id.slice(0, 8)}] ${job.enabled ? "启用" : "已暂停"} | ${job.description}`,
    `  周期: ${job.cron_expr} | 类型: ${job.handler_type}`,
  ]
  if (job.next_run_at) lines.push(`  下次: ${new Date(job.next_run_at * 1000).toLocaleString("zh-CN")}`)
  if (job.last_run_at) lines.push(`  上次: ${new Date(job.last_run_at * 1000).toLocaleString("zh-CN")}`)
  if (job.last_result) lines.push(`  最近结果: ${job.last_result.replace(/\s+/g, " ").slice(0, 120)}`)
  return lines.join("\n")
}

// ===== schedule_create =====

const scheduleCreateParams = Type.Object({
  description: Type.String({ description: "任务要做什么，一句话描述（中文），如：汇总今日待办并提醒" }),
  schedule: Type.String({ description: "执行时间的自然语言描述（如：每天早上9点、每周五17:30、每隔30分钟），或直接给 5 段 cron 表达式" }),
  handler_type: Type.Optional(
    Type.String({ description: "任务执行方式：session_continuation（默认，续跑当前对话）/ skill（调用技能包）/ script（运行脚本）" }),
  ),
  prompt: Type.Optional(
    Type.String({ description: "handler_type=session_continuation 时触发给助手的具体指令；省略时用 description" }),
  ),
  skill_name: Type.Optional(Type.String({ description: "handler_type=skill 时的技能包名称" })),
  skill_inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "handler_type=skill 时传给技能包的输入" })),
  script_path: Type.Optional(Type.String({ description: "handler_type=script 时的脚本绝对路径（Node 运行）" })),
})

export function createScheduleCreateTool(db: Database, sessionId: string): AgentTool<typeof scheduleCreateParams> {
  return {
    name: "schedule_create",
    label: "创建定时任务",
    description:
      "创建定时任务（如'每天早上9点汇总待办'）。时间支持中文自然语言，会转成 cron。创建后可在定时任务面板管理。创建前若用户没说清执行频率/时间，必须先追问，不要猜。",
    parameters: scheduleCreateParams,
    execute: async (_id, params) => {
      if (!params.description?.trim()) throw new Error("description 必填")
      if (!params.schedule?.trim()) throw new Error("schedule（执行时间）必填")

      const parsed = await parseScheduleToCron(params.schedule)
      if (!parsed.cron) {
        throw new Error(`无法确定执行时间：${parsed.note}。请向用户追问更明确的时间描述（如"每天几点"）。`)
      }

      const handlerType = (params.handler_type as (typeof HANDLER_TYPES)[number]) || "session_continuation"
      if (!HANDLER_TYPES.includes(handlerType)) {
        throw new Error(`handler_type 必须是 ${HANDLER_TYPES.join(" / ")} 之一`)
      }

      let handlerConfig: Record<string, unknown>
      if (handlerType === "session_continuation") {
        handlerConfig = { sessionId, prompt: params.prompt?.trim() || params.description.trim() }
      } else if (handlerType === "skill") {
        if (!params.skill_name?.trim()) throw new Error("handler_type=skill 时 skill_name 必填")
        handlerConfig = { skillName: params.skill_name.trim(), inputs: params.skill_inputs ?? {} }
      } else {
        if (!params.script_path?.trim()) throw new Error("handler_type=script 时 script_path 必填")
        handlerConfig = { scriptPath: params.script_path.trim() }
      }

      const nextRun = computeNextRunSeconds(parsed.cron)
      const input: ScheduledJobCreateInput = {
        description: params.description.trim(),
        cron_expr: parsed.cron,
        handler_type: handlerType,
        handler_config: handlerConfig,
        enabled: 1,
        next_run_at: nextRun ?? undefined,
        created_by_session: sessionId,
      }
      const job = db.scheduledJob.create(input)
      const nextText = nextRun ? new Date(nextRun * 1000).toLocaleString("zh-CN") : "未知"
      return {
        content: [
          {
            type: "text",
            text: `定时任务已创建：${job.description}\n执行周期：${parsed.cron}（${parsed.note}）\n下次执行：${nextText}\n任务ID：${job.id}`,
          },
        ],
        details: { jobId: job.id, cron: job.cron_expr, nextRunAt: nextRun },
      }
    },
  }
}

// ===== schedule_list =====

const scheduleListParams = Type.Object({
  include_disabled: Type.Optional(Type.Boolean({ description: "是否包含已暂停任务，默认 true" })),
})

export function createScheduleListTool(db: Database): AgentTool<typeof scheduleListParams> {
  return {
    name: "schedule_list",
    label: "查看定时任务",
    description: "列出所有定时任务及其启用状态、cron、下次/上次执行时间、最近结果。",
    parameters: scheduleListParams,
    execute: async (_id, params) => {
      const all = db.scheduledJob.listAll()
      const jobs = params.include_disabled === false ? all.filter((j) => j.enabled) : all
      if (jobs.length === 0) {
        return { content: [{ type: "text", text: "当前没有定时任务。用户可直接用自然语言描述（如'每天9点提醒我站会'）来创建。" }], details: { count: 0 } }
      }
      return {
        content: [{ type: "text", text: `共 ${jobs.length} 个定时任务：\n${jobs.map(formatJob).join("\n")}` }],
        details: { count: jobs.length },
      }
    },
  }
}

// ===== schedule_toggle =====

const scheduleToggleParams = Type.Object({
  job_id: Type.String({ description: "任务ID（完整 UUID，从 schedule_list 返回中取）" }),
  enabled: Type.Boolean({ description: "true=开启，false=暂停" }),
})

export function createScheduleToggleTool(db: Database): AgentTool<typeof scheduleToggleParams> {
  return {
    name: "schedule_toggle",
    label: "启停定时任务",
    description: "开启或暂停一个定时任务。",
    parameters: scheduleToggleParams,
    execute: async (_id, params) => {
      const job = db.scheduledJob.get(params.job_id)
      if (!job) throw new Error(`任务不存在: ${params.job_id}`)
      // 重新开启时重算 next_run_at
      const nextRun = params.enabled ? computeNextRunSeconds(job.cron_expr) : null
      db.scheduledJob.setEnabled(params.job_id, params.enabled ? 1 : 0, nextRun)
      return {
        content: [{ type: "text", text: `任务「${job.description}」已${params.enabled ? "开启" : "暂停"}${nextRun ? `，下次执行 ${new Date(nextRun * 1000).toLocaleString("zh-CN")}` : ""}。` }],
        details: { jobId: params.job_id, enabled: params.enabled, nextRunAt: nextRun },
      }
    },
  }
}

// ===== schedule_delete =====

const scheduleDeleteParams = Type.Object({
  job_id: Type.String({ description: "任务ID（完整 UUID）" }),
})

export function createScheduleDeleteTool(db: Database): AgentTool<typeof scheduleDeleteParams> {
  return {
    name: "schedule_delete",
    label: "删除定时任务",
    description: "永久删除一个定时任务（不支持改 cron，需要调整请删除后重建）。",
    parameters: scheduleDeleteParams,
    execute: async (_id, params) => {
      const job = db.scheduledJob.get(params.job_id)
      if (!job) throw new Error(`任务不存在: ${params.job_id}`)
      db.scheduledJob.delete(params.job_id)
      return { content: [{ type: "text", text: `任务「${job.description}」已删除。` }], details: { jobId: params.job_id } }
    },
  }
}

// ===== schedule_run_now =====

const scheduleRunNowParams = Type.Object({
  job_id: Type.String({ description: "任务ID（完整 UUID）" }),
})

export function createScheduleRunNowTool(runNow: (jobId: string) => Promise<void>): AgentTool<typeof scheduleRunNowParams> {
  return {
    name: "schedule_run_now",
    label: "立即执行任务",
    description: "立即手动执行一次定时任务（不影响其原计划）。执行可能耗时较长。",
    parameters: scheduleRunNowParams,
    execute: async (_id, params) => {
      if (!params.job_id?.trim()) throw new Error("job_id 必填")
      await runNow(params.job_id)
      return { content: [{ type: "text", text: "任务已执行完成，结果可在定时任务面板查看。" }], details: { jobId: params.job_id } }
    },
  }
}
