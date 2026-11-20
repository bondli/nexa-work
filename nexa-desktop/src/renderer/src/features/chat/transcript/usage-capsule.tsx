/** 用量胶囊：紧凑显示 token 总量，hover/focus 弹出输入/缓存/输出/合计明细 */
import { useState } from "react"
import { Zap } from "lucide-react"
import { formatTokens } from "@renderer/lib/utils"
import { formatThroughput } from "../lib/format"

type UsageInput =
  | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number }
  | null
  | undefined

export function UsageCapsule({ usage, durationMs }: { usage: UsageInput; durationMs?: number | null }) {
  const [open, setOpen] = useState(false)
  // 合计优先用后端给的 totalTokens；缺失时按 输入 + 输出 + 缓存读 + 缓存写 兜底
  const total =
    usage?.totalTokens ??
    (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0)
  if (!total) return null
  const throughput = formatThroughput(usage?.output, durationMs)
  const hasCache = (usage?.cacheRead ?? 0) > 0 || (usage?.cacheWrite ?? 0) > 0

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
      >
        <Zap className="h-3 w-3" />
        {formatTokens(total)}
        {throughput ? <span className="text-muted-foreground/70">· {throughput}</span> : null}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-border bg-card p-3 text-xs shadow-lg">
          <Row label="输入" value={usage?.input ? formatTokens(usage.input) : "—"} />
          {hasCache && (
            <>
              <Row
                label="缓存读取"
                value={usage?.cacheRead ? formatTokens(usage.cacheRead) : "—"}
              />
              <Row
                label="缓存写入"
                value={usage?.cacheWrite ? formatTokens(usage.cacheWrite) : "—"}
              />
            </>
          )}
          <Row label="输出" value={usage?.output ? formatTokens(usage.output) : "—"} />
          <div className="my-1.5 h-px bg-border" />
          <Row label="合计" value={formatTokens(total)} bold />
        </div>
      )}
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-medium text-foreground" : "text-foreground"}>{value}</span>
    </div>
  )
}
