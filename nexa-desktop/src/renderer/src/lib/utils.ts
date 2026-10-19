import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 相对时间显示。兼容秒级/毫秒级时间戳：
 * SQLite 统一存秒级（Date.now()/1000），值 < 1e12 时视为秒并转毫秒
 */
export function timeAgo(input: number): string {
  const ts = input < 1e12 ? input * 1000 : input
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString("zh-CN")
}

/**
 * 消息时间戳展示（绝对时间，输入毫秒，兼容秒级值）：
 * 今天 → "14:30"；昨天 → "昨天 14:30"；更早 → "2026/10/16 14:30"
 * 「今天/昨天」按本地日历天判定（用日期构造做增减，避免 DST 下减 24h 出错）
 */
export function formatMessageTime(input: number): string {
  const ts = input < 1e12 ? input * 1000 : input
  const d = new Date(ts)
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  if (ts >= startOfToday) return time
  if (ts >= startOfYesterday) return `昨天 ${time}`
  return `${d.toLocaleDateString("zh-CN")} ${time}`
}
