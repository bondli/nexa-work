/**
 * shadcn ai-elements 本地实现：Reasoning（思考过程）
 * 对齐 https://ui.shadcn.com/docs/ai-elements/base/reasoning
 *
 * 运行中自动展开并跟随流式输出；正文到达/结束时自动收拢，点击标题仍可回看。
 */
import { useEffect, useRef, useState } from "react"
import { Brain, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { Shimmer } from "@renderer/components/ai-elements/shimmer"

export function Reasoning({
  content,
  streaming,
  className,
}: {
  content: string
  streaming?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(Boolean(streaming))
  const wasStreaming = useRef(Boolean(streaming))

  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true
      setOpen(true)
      return
    }
    if (!wasStreaming.current) return
    wasStreaming.current = false
    // 流结束稍等一拍再收拢，避免正文刚出现时高度突变
    const timer = setTimeout(() => setOpen(false), 600)
    return () => clearTimeout(timer)
  }, [streaming])

  return (
    <div className={cn("w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-90")}
        />
        <Brain className="h-3 w-3 shrink-0" />
        {streaming ? <Shimmer>思考中…</Shimmer> : <span>思考过程</span>}
        {streaming && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      </button>
      {open && (
        <div className="mt-0.5 border-l border-border/80 pl-3">
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-muted-foreground">
            {content || "…"}
            {streaming && <span className="agent-caret" />}
          </pre>
        </div>
      )}
    </div>
  )
}
