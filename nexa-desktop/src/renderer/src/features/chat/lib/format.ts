/**
 * 聊天/轨迹渲染用的纯展示格式化函数（无副作用、可被纯函数层复用）。
 * 从 chat-shell 迁出 formatRunDuration，并补充 plan 状态归一化、吞吐等工具。
 */

/** plan/任务步骤的归一化状态（渲染层统一用语） */
export type TodoStatus = "pending" | "in_progress" | "completed" | "failed"

/** 毫秒 → "42s" / "1m20s" / "2h05m" */
export function formatRunDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "0s"
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`
  return `${s}s`
}

/**
 * plan 步骤状态归一化：兼容主进程实际取值 pending/active/done/failed，
 * 也兼容可能的 in_progress/running/completed/success/error。
 */
export function normalizeTodoStatus(raw: string): TodoStatus {
  switch (raw) {
    case "active":
    case "in_progress":
    case "running":
      return "in_progress"
    case "done":
    case "completed":
    case "success":
      return "completed"
    case "failed":
    case "error":
      return "failed"
    default:
      return "pending"
  }
}

/** 工具调用耗时展示（秒，保留 1 位小数） */
export function formatToolDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ""
  const s = ms / 1000
  if (s < 1) return `${Math.max(s, 0.1).toFixed(1)}s`
  return `${s.toFixed(1)}s`
}

/** 输出吞吐：outputTokens / 秒，空值返回 "" */
export function formatThroughput(outputTokens: number | undefined, durationMs: number | null | undefined): string {
  if (!outputTokens || !durationMs || durationMs <= 0) return ""
  const tps = outputTokens / (durationMs / 1000)
  return `${tps.toFixed(tps < 10 ? 1 : 0)} tok/s`
}

/** provider/modelId → 显示名（与 main/index.ts 的 availableModels 保持同步） */
export function formatModelName(model: string): string {
  const map: Record<string, string> = {
    "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
    "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek/deepseek-v3.2": "DeepSeek V3.2",
  }
  return map[model] ?? model.split("/").pop() ?? model
}

/** 长路径缩略为最后两段: /a/b/c/d → …/c/d */
export function shortenPath(p: string): string {
  const parts = p.split("/").filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p
}
