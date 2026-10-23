/**
 * shadcn ai-elements 本地实现：Task（任务轨迹折叠条）
 * 对齐 https://ui.shadcn.com/docs/ai-elements/base/task
 *
 * 极简形态：一行灰色「已完成 42s ›」，点击展开执行过程（思考 / 工具 / 中间消息）。
 * 运行中默认展开，结束后自动收拢，让最终回答成为视觉焦点。
 */
import { useEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { Shimmer } from "@renderer/components/ai-elements/shimmer"

export type TaskStatus = "running" | "completed" | "failed" | "paused"

export function Task({
  status,
  durationLabel,
  children,
  className,
}: {
  status: TaskStatus
  /** 已完成时展示的耗时文案，如「42s」 */
  durationLabel?: string | null
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(status === "running")
  const prevStatus = useRef(status)

  useEffect(() => {
    if (status === "running") {
      setOpen(true)
    } else if (prevStatus.current === "running") {
      // 运行结束的瞬间收拢，让最终回答成为视觉焦点
      setOpen(false)
    }
    prevStatus.current = status
  }, [status])

  const label =
    status === "running" ? (
      <Shimmer>执行中</Shimmer>
    ) : status === "failed" ? (
      "失败"
    ) : status === "paused" ? (
      "已暂停"
    ) : (
      "已完成"
    )

  return (
    <div className={cn("w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] leading-5 text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{label}</span>
        {status !== "running" && durationLabel && <span className="tabular-nums">{durationLabel}</span>}
        <ChevronRight
          className={cn("h-3 w-3 transition-transform duration-200", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1.5 border-l border-border/70 pl-3">
          {children}
        </div>
      )}
    </div>
  )
}
