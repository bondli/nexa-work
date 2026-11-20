/** 工具调用渲染：可折叠，头部显示工具名/状态/耗时，展开看入参与结果 */
import { ChevronRight, Loader2, Check, X, Wrench } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { formatToolDuration } from "../lib/format"
import type { ChatMessage } from "@renderer/stores/conversation-store"
import { useAutomaticDisclosure } from "./disclosure"

function pretty(value: unknown): string {
  if (value == null) return ""
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function ToolCallRow({ message }: { message: ChatMessage }) {
  const tc = message.toolCall
  if (!tc) return null
  const pending = tc.success === undefined
  const failed = tc.success === false
  const disclosure = useAutomaticDisclosure({ key: `tool:${message.id}`, initiallyOpen: pending })

  return (
    <div>
      <button
        type="button"
        onClick={disclosure.toggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", disclosure.open && "rotate-90")} />
        <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-foreground">{tc.toolName}</span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {tc.durationMs ? formatToolDuration(tc.durationMs) : null}
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          ) : failed ? (
            <X className="h-3 w-3 text-destructive" />
          ) : (
            <Check className="h-3 w-3 text-emerald-500" />
          )}
        </span>
      </button>
      {disclosure.open && (
        <div className="space-y-2 px-2 py-1.5">
          {pretty(tc.args) && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">入参</div>
              <pre className="max-h-48 overflow-auto rounded bg-card p-2 font-mono text-[11px] leading-relaxed">
                {pretty(tc.args)}
              </pre>
            </div>
          )}
          {pretty(tc.result) && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">结果</div>
              <pre className={cn("max-h-60 overflow-auto rounded bg-card p-2 font-mono text-[11px] leading-relaxed", failed && "text-destructive")}>
                {pretty(tc.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
