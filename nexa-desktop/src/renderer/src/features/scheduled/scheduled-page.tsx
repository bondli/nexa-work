/**
 * 定时任务管理面板 (M5)
 * - 顶部 tab 组：定时任务（3 列卡片 + 状态筛选）/ 运行记录（全部执行记录倒序列表）
 * - 顶部提示卡：任务只能在对话中用自然语言创建（无任务时展示）
 * - 卡片操作：暂停·开启 / 立即执行 / 删除（删除走 shadcn Dialog 二次确认）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Lightbulb, Pause, Play, Trash2, Loader2, AlertTriangle, Inbox, Zap } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@renderer/components/ui/dialog"
import { cn } from "@renderer/lib/utils"
import { PageTitleBar } from "@renderer/components/page-layout"
import { useConversationStore } from "@renderer/stores/conversation-store"
import { useSettingsOpen } from "@renderer/stores/ui-store"

interface JobItem {
  id: string
  description: string
  cron_expr: string
  handler_type: string
  handler_config: Record<string, unknown>
  enabled: 0 | 1
  last_run_at: number | null
  next_run_at: number | null
  last_result: string | null
  created_at: number
  created_by_session: string | null
  runCount: number
  /** 最近一次执行成败：1 成功 / 0 失败 / null 未执行过 */
  lastSuccess: 0 | 1 | null
}

/** 单次运行记录（job_runs 表，秒级时间戳） */
interface JobRunItem {
  id: string
  job_id: string
  started_at: number
  finished_at: number | null
  success: 0 | 1
  output: string | null
  artifacts: string[] | null
  /** 本次运行实际使用的会话（session_continuation）；历史记录或无会话 handler 为 null */
  session_id: string | null
}

const HANDLER_LABEL: Record<string, string> = {
  session_continuation: "续跑对话",
  skill: "技能包",
  script: "脚本",
}

function fmtTime(sec: number | null): string {
  if (!sec) return "—"
  return new Date(sec * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec} 秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

type JobFilter = "all" | "active" | "paused"

const FILTER_TABS: { id: JobFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "active", label: "已启动" },
  { id: "paused", label: "已暂停" },
]

/** 页面级 tab：定时任务列表 / 全部运行记录 */
type PageTab = "jobs" | "runs"

const PAGE_TABS: { id: PageTab; label: string }[] = [
  { id: "jobs", label: "定时任务" },
  { id: "runs", label: "运行记录" },
]

/** 运行记录每页条数（触底加载下一页） */
const RUNS_PAGE_SIZE = 30

export function ScheduledPage() {
  const [tab, setTab] = useState<PageTab>("jobs")
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<JobFilter>("all")
  /** 已加载的运行记录（null = 尚未加载） */
  const [runs, setRuns] = useState<JobRunItem[] | null>(null)
  const [runsHasMore, setRunsHasMore] = useState(true)
  const [runsLoadingMore, setRunsLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 待删除任务（null 表示确认弹框关闭） */
  const [pendingDelete, setPendingDelete] = useState<JobItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  /** 操作提示弹框（替代 window.alert） */
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)

  const refresh = useCallback(async () => {
    const list = (await window.nexa.jobList()) as JobItem[]
    // 启用任务排前面，再按下次执行时间升序
    list.sort((a, b) => {
      if (a.enabled !== b.enabled) return b.enabled - a.enabled
      return (a.next_run_at ?? Infinity) - (b.next_run_at ?? Infinity)
    })
    setJobs(list)
    setLoading(false)
  }, [])

  /**
   * 拉取运行记录：offset = 0 取最新一页（替换），否则追加
   * 每页 RUNS_PAGE_SIZE 条，返回不足一页说明已到底
   */
  const loadRuns = useCallback(async (offset: number) => {
    if (offset > 0) setRunsLoadingMore(true)
    try {
      const list = (await window.nexa.jobRuns({ limit: RUNS_PAGE_SIZE, offset })) as JobRunItem[]
      setRuns((prev) => (offset === 0 ? list : [...(prev ?? []), ...list]))
      setRunsHasMore(list.length === RUNS_PAGE_SIZE)
    } finally {
      if (offset > 0) setRunsLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // 任务列表每 15s 刷新（调度状态）；运行记录不参与，避免滚动中列表被重置
    const timer = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(timer)
  }, [refresh])

  // 切到「运行记录」时加载最新一页
  useEffect(() => {
    if (tab === "runs") void loadRuns(0)
  }, [tab, loadRuns])

  /** 触底加载下一页（距底部 120px 内触发） */
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el || tab !== "runs" || !runsHasMore || runsLoadingMore) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      void loadRuns(runs?.length ?? 0)
    }
  }

  const toggle = async (job: JobItem) => {
    setBusyId(job.id)
    try {
      await window.nexa.jobToggle({ id: job.id, enabled: job.enabled !== 1 })
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const remove = (job: JobItem) => setPendingDelete(job)

  /** 确认删除（Electron 下 window.confirm 样式不统一，改用 shadcn Dialog） */
  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await window.nexa.jobDelete(pendingDelete.id)
      setPendingDelete(null)
      await refresh()
    } finally {
      setDeleting(false)
    }
  }

  const runNow = async (job: JobItem) => {
    setBusyId(job.id)
    try {
      await window.nexa.jobRunNow(job.id)
      await refresh()
    } catch (err) {
      setNotice({ title: "执行失败", message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusyId(null)
    }
  }

  const hasJobs = jobs.length > 0
  const activeCount = jobs.filter((j) => j.enabled === 1).length
  const pausedCount = jobs.length - activeCount
  const filterCounts: Record<JobFilter, number> = {
    all: jobs.length,
    active: activeCount,
    paused: pausedCount,
  }
  const visibleJobs = jobs.filter((j) =>
    filter === "all" ? true : filter === "active" ? j.enabled === 1 : j.enabled !== 1
  )

  /** run.job_id → 任务描述（运行记录列表展示归属；任务已删则回落占位文案） */
  const jobDescById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const j of jobs) map[j.id] = j.description
    return map
  }, [jobs])

  const selectSession = useConversationStore((s) => s.selectSession)
  const setActiveView = useSettingsOpen((s) => s.setActiveView)

  /** 运行记录 → 跳转关联会话（先确认会话仍存在，对应会话被删的场景） */
  const openSession = async (sessionId: string) => {
    try {
      const [active, archived] = await Promise.all([
        window.nexa.listSessions({ archived: false }) as Promise<Array<{ id: string }>>,
        window.nexa.listSessions({ archived: true }) as Promise<Array<{ id: string }>>,
      ])
      if (![...active, ...archived].some((s) => s.id === sessionId)) {
        setNotice({ title: "无法打开会话", message: "关联会话已被删除。任务下次运行时会自动重建会话。" })
        return
      }
      await selectSession(sessionId)
      setActiveView("chat")
    } catch (err) {
      setNotice({ title: "打开会话失败", message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageTitleBar
        title="定时任务"
        actions={
          /* 页面 tab 组（分段控件）：定时任务 / 运行记录 */
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {PAGE_TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        }
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"
      >
        {tab === "runs" ? (
          <RunHistoryList
            runs={runs}
            jobDescById={jobDescById}
            hasMore={runsHasMore}
            loadingMore={runsLoadingMore}
            onOpenSession={(sessionId) => void openSession(sessionId)}
          />
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <>
            {!hasJobs && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="text-sm leading-relaxed">
                  <div className="font-medium text-primary">为什么没有“新建”按钮？</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Nexa 不在这里创建定时任务 —— 直接在对话中描述（“每天早上…”、“每周五…”），Agent 会自动识别并创建。这里只负责管理已有任务。
                  </div>
                </div>
              </div>
            )}
            {hasJobs ? (
              <>
                {/* 状态筛选 tab（带数量） */}
                <div className="mb-4 flex flex-wrap items-center gap-1.5">
                  {FILTER_TABS.map((t) => {
                    const active = filter === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => setFilter(t.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        {t.label}
                        <span className={active ? "text-primary/70" : "text-muted-foreground/60"}>{filterCounts[t.id]}</span>
                      </button>
                    )
                  })}
                </div>
                {visibleJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
                    <Inbox className="h-6 w-6 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">该筛选下暂无任务</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {visibleJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        busy={busyId === job.id}
                        onToggle={() => void toggle(job)}
                        onRunNow={() => void runNow(job)}
                        onDelete={() => remove(job)}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
                <Inbox className="h-6 w-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">还没有定时任务</p>
                <p className="text-xs text-muted-foreground/70">去对话里说一句“每天早上 9 点提醒我…”试试</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 删除确认弹框（替代 window.confirm） */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除这个定时任务？</DialogTitle>
            <DialogDescription className="break-words">
              {pendingDelete?.description ? `「${pendingDelete.description}」删除后不可恢复。` : "删除后不可恢复。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 操作提示弹框（替代 window.alert） */}
      <Dialog open={!!notice} onOpenChange={(open) => { if (!open) setNotice(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              {notice?.title}
            </DialogTitle>
            <DialogDescription className="break-words">{notice?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" onClick={() => setNotice(null)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function JobCard({
  job,
  busy,
  onToggle,
  onRunNow,
  onDelete,
}: {
  job: JobItem
  busy: boolean
  onToggle: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  const enabled = job.enabled === 1
  const lastFailed = job.lastSuccess === 0

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      {/* 首行: 状态徽章（左） + 操作按钮（右上角，一排纯图标） */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium",
              enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", enabled ? "bg-emerald-500" : "bg-muted-foreground")} />
            {enabled ? "运行中" : "已暂停"}
          </span>
          {lastFailed && (
            <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" />
              最近失败
            </span>
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {HANDLER_LABEL[job.handler_type] ?? job.handler_type}
          </span>
        </div>

        {/* 图标操作行: 立即执行 / 暂停·开启 / 删除 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="立即执行"
            title="立即执行"
            disabled={busy}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onRunNow}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={enabled ? "暂停" : "开启"}
            title={enabled ? "暂停" : "开启"}
            disabled={busy}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            {enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="删除"
            title="删除"
            disabled={busy}
            className="h-7 w-7 text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 描述（窄卡限 2 行，悬浮看全文） */}
      <div className="mt-2 line-clamp-2 text-sm font-semibold leading-snug" title={job.description}>{job.description}</div>

      {/* 元信息（mt-auto 保证同行卡片底部对齐） */}
      <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3 text-[11px] text-muted-foreground">
        <span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{job.cron_expr}</code>
        </span>
        <span>下次: {fmtTime(job.next_run_at)}</span>
        <span>上次: {fmtTime(job.last_run_at)}</span>
        <span>共 {job.runCount} 次</span>
      </div>
    </div>
  )
}

/** 运行记录列表（按执行时间倒序，触底加载更多；点击有会话的记录可跳转） */
function RunHistoryList({
  runs,
  jobDescById,
  hasMore,
  loadingMore,
  onOpenSession,
}: {
  runs: JobRunItem[] | null
  jobDescById: Record<string, string>
  hasMore: boolean
  loadingMore: boolean
  onOpenSession: (sessionId: string) => void
}) {
  if (runs === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中…
      </div>
    )
  }
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
        <Inbox className="h-6 w-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">还没有运行记录</p>
        <p className="text-xs text-muted-foreground/70">任务执行后这里会按时间倒序展示每次执行结果</p>
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* 表头（宽屏显示，窄屏隐藏） */}
      <div className="hidden items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground md:flex">
        <span className="w-1.5 shrink-0" />
        <span className="min-w-0 flex-1">任务</span>
        <span className="w-28 shrink-0">执行时间</span>
        <span className="w-20 shrink-0">耗时</span>
        <span className="w-12 shrink-0 text-right">结果</span>
      </div>
      <div className="divide-y divide-border">
        {runs.map((run) => {
          const clickable = !!run.session_id
          return (
            <div
              key={run.id}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              title={clickable ? "点击打开关联会话" : undefined}
              onClick={() => {
                if (clickable) onOpenSession(run.session_id!)
              }}
              onKeyDown={(e) => {
                if (clickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault()
                  onOpenSession(run.session_id!)
                }
              }}
              className={cn(
                "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left outline-none transition-colors md:flex-nowrap",
                clickable && "cursor-pointer hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              )}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", run.success === 1 ? "bg-emerald-500" : "bg-destructive")} />
              <span className="min-w-0 flex-1 truncate text-xs">
                {jobDescById[run.job_id] ?? "（任务已删除）"}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground md:w-28">{fmtTime(run.started_at)}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground md:w-20">
                {run.finished_at ? fmtDuration(run.finished_at - run.started_at) : "进行中"}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] font-medium md:w-12 md:text-right",
                  run.success === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                )}
              >
                {run.success === 1 ? "成功" : "失败"}
              </span>
            </div>
          )
        })}
      </div>

      {/* 触底加载状态 */}
      <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {loadingMore ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中…
          </>
        ) : hasMore ? (
          "向下滚动加载更多"
        ) : (
          `已加载全部 ${runs.length} 条`
        )}
      </div>
    </div>
  )
}
