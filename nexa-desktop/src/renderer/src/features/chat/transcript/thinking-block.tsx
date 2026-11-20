/** 思考过程渲染块：可折叠，流式中默认展开且标签带 shimmer */
import { ChevronRight, Brain } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useTranscriptPrefs } from "../stores/transcript-prefs"
import { useAutomaticDisclosure } from "./disclosure"

interface ThinkingBlockProps {
  messageId: string
  thinking: string
  streaming: boolean
}

export function ThinkingBlock({ messageId, thinking, streaming }: ThinkingBlockProps) {
  const autoCollapseThinking = useTranscriptPrefs((s) => s.autoCollapseThinking)
  // 流式中默认展开；已完成按偏好默认收拢
  const initiallyOpen = streaming ? true : !autoCollapseThinking
  const disclosure = useAutomaticDisclosure({ key: `thinking:${messageId}`, initiallyOpen })

  return (
    <div>
      <button
        type="button"
        onClick={disclosure.toggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", disclosure.open && "rotate-90")} />
        <Brain className="h-3.5 w-3.5" />
        <span className={streaming ? "ai-shimmer" : ""}>思考过程</span>
        <span className="ml-auto text-[11px] text-muted-foreground/70">{thinking.length} 字</span>
      </button>
      {disclosure.open && (
        <div className="px-2 pb-1 text-xs leading-relaxed text-muted-foreground">
          <div className="whitespace-pre-wrap break-words">{thinking}</div>
        </div>
      )}
    </div>
  )
}
