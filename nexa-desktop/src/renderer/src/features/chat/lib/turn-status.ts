/**
 * 推导 turn 当前阶段（给运行状态条与折叠头文案用）。
 * 只做纯判断，不持有状态。
 */
import type { Turn } from "./build-turns"

export type TurnPhase = "thinking" | "working" | "waiting" | "completed" | "failed" | "paused"

export interface TurnPhaseInfo {
  phase: TurnPhase
  label: string
}

export function turnProcessPhase(turn: Turn): TurnPhaseInfo {
  const { run, processParts } = turn
  if (!turn.running) {
    switch (run.status) {
      case "failed":
        return { phase: "failed", label: "失败" }
      case "paused":
        return { phase: "paused", label: "已暂停" }
      default:
        return { phase: "completed", label: "已完成" }
    }
  }
  // running：优先判断是否有未完成的工具调用
  const hasPendingTool = processParts.some(
    (p) => p.kind === "tool" && p.message.toolCall && p.message.toolCall.success === undefined,
  )
  const hasThinking = processParts.some((p) => p.kind === "thinking" && p.streaming)
  if (hasPendingTool) return { phase: "working", label: "执行中" }
  if (hasThinking) return { phase: "thinking", label: "思考中" }
  return { phase: "waiting", label: "等待模型" }
}
