/** 错误消息展示 */
import { AlertTriangle } from "lucide-react"
import { cn } from "@renderer/lib/utils"

export function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className={cn("whitespace-pre-wrap break-words")}>{content || "执行出错"}</span>
    </div>
  )
}
