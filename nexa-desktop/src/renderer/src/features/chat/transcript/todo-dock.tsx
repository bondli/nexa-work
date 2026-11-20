/**
 * 悬浮任务清单：取最近一条有 plan 的 turn，显示在输入框上方。
 * 折叠态：完成进度 + 当前进行中步骤；展开态：全部步骤列表。运行中默认展开。
 */
import { useEffect, useState } from "react"
import { ChevronDown, ListTodo, Loader2, Check, Circle, AlertCircle } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import type { Turn } from "../lib/build-turns"
import type { PlanStepView } from "../lib/build-turns"

export function TodoDock({ turns }: { turns: Turn[] }) {
  const planTurn = [...turns].reverse().find((t) => t.plan && t.plan.length > 0)
  const plan = planTurn?.plan ?? null
  const [open, setOpen] = useState(false)
  // 运行中的计划默认展开；完成后折叠
  useEffect(() => {
    setOpen(!!planTurn?.running)
  }, [planTurn?.running, planTurn?.id])

  if (!plan || plan.length === 0) return null
  const done = plan.filter((s) => s.status === "completed").length
  const current = plan.find((s) => s.status === "in_progress")

  return (
    <div className="rounded-lg border border-border/60 bg-card/80 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ListTodo className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">任务清单</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {done}/{plan.length}
        </span>
        {current && !open && (
          <span className="ml-1 truncate text-xs text-muted-foreground ai-shimmer">{current.description}</span>
        )}
        <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="max-h-40 space-y-1 overflow-auto border-t border-border/50 px-3 py-2">
          {plan.map((s) => (
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
      )}
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
