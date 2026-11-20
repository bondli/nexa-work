/** 计划步骤在消息过程中的展示（紧凑列表）；悬浮任务清单另见 todo-dock */
import { Check, Loader2, Circle, AlertCircle } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import type { PlanStepView } from "../lib/build-turns"

export function PlanStepsBlock({ steps }: { steps: PlanStepView[] }) {
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>任务计划</span>
        <span className="ml-auto">
          {steps.filter((s) => s.status === "completed").length}/{steps.length}
        </span>
      </div>
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            <StepIcon status={s.status} />
            <span
              className={cn(
                "leading-relaxed",
                s.status === "completed" && "text-muted-foreground line-through",
                s.status === "in_progress" && "ai-shimmer text-foreground",
              )}
            >
              {s.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StepIcon({ status }: { status: PlanStepView["status"] }) {
  switch (status) {
    case "completed":
      return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
    case "in_progress":
      return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
    case "failed":
      return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
    default:
      return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
  }
}
