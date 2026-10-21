/**
 * 时间格式化 —— 桌面端 SQLite 的时间字段统一是「秒」（Math.floor(Date.now()/1000)），
 * 手机端直接 new Date(秒) 会被当成毫秒解析，显示成 1970 年。
 * 这里统一做单位识别（>1e12 视为毫秒，其余按秒），各页面都走这两个函数。
 */

/** 兼容秒/毫秒的时间戳转 Date；空值返回 null */
export function toDate(ts: number | null | undefined): Date | null {
  if (!ts) return null
  return new Date(ts > 1e12 ? ts : ts * 1000)
}

/** 简短格式：10月21日 12:39 */
export function fmtTsShort(ts: number | null | undefined): string {
  const d = toDate(ts)
  if (!d) return ""
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** 完整格式：2026/10/21 12:39 */
export function fmtTsFull(ts: number | null | undefined): string {
  const d = toDate(ts)
  if (!d) return "—"
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
