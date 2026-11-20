/**
 * AssistantTurn 的 memo 自定义比较：仅比较影响渲染的字段，
 * 使流式更新时已稳定的历史 turn 不重渲染（性能边界）。
 * plan 变化不影响 turn 正文渲染（plan 由 TodoDock 单独消费），故不纳入比较。
 */
import type { Turn, TurnProcessPart } from "./build-turns"

function partsEqual(a: TurnProcessPart[], b: TurnProcessPart[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.kind !== y.kind || x.message.id !== y.message.id) return false
    if (x.kind === "thinking" && y.kind === "thinking") {
      if (x.thinking !== y.thinking || x.streaming !== y.streaming) return false
    }
    if (x.kind === "tool" && y.kind === "tool") {
      const xt = x.message.toolCall
      const yt = y.message.toolCall
      if ((xt?.success ?? null) !== (yt?.success ?? null)) return false
      if ((xt?.durationMs ?? null) !== (yt?.durationMs ?? null)) return false
    }
  }
  return true
}

function answerEqual(
  a: Turn["answer"],
  b: Turn["answer"],
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.content === b.content &&
    a.streaming === b.streaming &&
    a.model === b.model &&
    a.createdAt === b.createdAt &&
    (a.usage?.totalTokens ?? null) === (b.usage?.totalTokens ?? null)
  )
}

export function areTurnsRenderEqual(a: Turn, b: Turn): boolean {
  if (a === b) return true
  return (
    a.id === b.id &&
    a.running === b.running &&
    a.streaming === b.streaming &&
    a.run.status === b.run.status &&
    a.run.durationMs === b.run.durationMs &&
    a.run.toolCallCount === b.run.toolCallCount &&
    (a.user?.id ?? null) === (b.user?.id ?? null) &&
    (a.user?.content ?? null) === (b.user?.content ?? null) &&
    (a.user?.attachments?.length ?? 0) === (b.user?.attachments?.length ?? 0) &&
    answerEqual(a.answer, b.answer) &&
    partsEqual(a.processParts, b.processParts)
  )
}
