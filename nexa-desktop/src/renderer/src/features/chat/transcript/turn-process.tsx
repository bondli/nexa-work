/**
 * turn 统一折叠头：状态文案 + 实时耗时（运行中每秒刷新）+ 工具调用数 + caret。
 * active 默认展开、settled 按偏好默认收拢；用户手动切换会被记住。
 * 展开后渲染 ProcessContent（思考/工具/计划/错误）。
 */
import { useEffect, useState } from "react"
import { ChevronRight, Check, Loader2, AlertCircle, Pause } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { formatRunDuration } from "../lib/format"
import { turnProcessPhase } from "../lib/turn-status"
import type { Turn } from "../lib/build-turns"
import { useTranscriptPrefs } from "../stores/transcript-prefs"
import { useAutomaticDisclosure } from "./disclosure"
import { ProcessContent } from "./process-content"

export function TurnProcess({ turn }: { turn: Turn }) {
  const autoCollapseSettled = useTranscriptPrefs((s) => s.autoCollapseSettled)
  const initiallyOpen = turn.running ? true : !autoCollapseSettled
  const disclosure = useAutomaticDisclosure({ key: `turn:${turn.id}`, initiallyOpen })
  const phase = turnProcessPhase(turn)

  // 运行中每秒刷新以更新耗时显示
  const [, force] = useState(0)
  useEffect(() => {
    if (!turn.running) return
    const t = window.setInterval(() => force((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [turn.running])
  const elapsed = turn.running ? Date.now() - turn.run.startedAt : turn.run.durationMs

  const hasProcess = turn.processParts.length > 0 || turn.running
  if (!hasProcess) return null

  return (
    <div>
      <button
        type="button"
        onClick={disclosure.toggle}
        className="flex w-full items-center gap-2 border-b border-border/60 py-1 pb-2 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <PhaseIcon phase={phase.phase} />
        <span className={cn("text-sm font-medium", turn.running && "ai-shimmer")}>{phase.label}</span>
        <span className="text-xs">{formatRunDuration(elapsed)}</span>
        {turn.run.toolCallCount > 0 && (
          <span className="text-xs">· {turn.run.toolCallCount} 次工具调用</span>
        )}
        <ChevronRight
          className={cn("h-4 w-4 shrink-0 opacity-80 transition-transform", disclosure.open && "rotate-90")}
        />
      </button>
      {disclosure.open && (
        <div className="mt-0.5 pb-1 pl-1">
          <ProcessContent turn={turn} />
        </div>
      )}
    </div>
  )
}

function PhaseIcon({ phase }: { phase: string }) {
  switch (phase) {
    case "completed":
      return <Check className="h-4 w-4 text-emerald-500" />
    case "failed":
      return <AlertCircle className="h-4 w-4 text-destructive" />
    case "paused":
      return <Pause className="h-4 w-4 text-muted-foreground" />
    default:
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  }
}
