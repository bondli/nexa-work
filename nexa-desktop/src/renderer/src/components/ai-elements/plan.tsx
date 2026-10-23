/**
 * shadcn ai-elements 本地实现：Plan（执行计划）
 * 对齐 https://ui.shadcn.com/docs/ai-elements/base/plan
 *
 * 顶部显示完成进度（x/y + 细进度条），步骤按状态给出不同图标与样式。
 */
import { CheckCircle2, Circle, Loader2, ListChecks, XCircle } from "lucide-react"
import { cn } from "@renderer/lib/utils"

interface PlanStep {
  id: string
  description: string
  status: string
}

function stepIcon(status: string) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    case "active":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  active: "执行中",
  done: "已完成",
  failed: "失败",
}

export function Plan({ steps, className }: { steps: PlanStep[]; className?: string }) {
  if (steps.length === 0) return null
  const done = steps.filter((s) => s.status === "done").length
  const hasFailed = steps.some((s) => s.status === "failed")
  const pct = Math.round((done / steps.length) * 100)

  return (
    <div className={cn("w-full rounded-xl border border-border bg-card/60 px-3 py-2.5", className)}>
      <div className="flex items-center gap-2 text-xs">
        <ListChecks className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium text-foreground">执行计划</span>
        <span className="ml-auto tabular-nums text-[10px] text-muted-foreground">
          <span className={cn(hasFailed && "text-destructive")}>{done}</span>/{steps.length}
        </span>
      </div>
      <div className="mb-2 mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full bg-primary transition-[width] duration-500", hasFailed && "bg-destructive")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="flex flex-col">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-2 rounded-md px-1 py-1 text-xs",
              step.status === "active" && "bg-primary/[0.06]"
            )}
          >
            <span className="mt-0.5 shrink-0">{stepIcon(step.status)}</span>
            <span
              className={cn(
                "min-w-0 flex-1 leading-relaxed",
                step.status === "done" && "text-muted-foreground",
                step.status === "failed" && "text-destructive",
                step.status === "active" && "font-medium text-foreground"
              )}
            >
              {step.description}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{STATUS_LABEL[step.status] ?? step.status}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
