/** 「回到底部」浮动按钮（用户上滑查看历史时出现） */
import { ChevronDown } from "lucide-react"
import { cn } from "@renderer/lib/utils"

export function JumpToLatest({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <ChevronDown className="h-3.5 w-3.5" />
      回到底部
    </button>
  )
}
