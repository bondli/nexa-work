/**
 * 将会话的扁平 ChatMessage[] 投影为以「轮（turn）」为单位的视图数据。
 *
 * 一个 turn = 一条用户消息触发的一轮 agent loop，包含：
 *  - processParts：过程片段（思考 / 工具 / 计划 / 错误 / 中间文本），按出现顺序
 *  - answer：最终回答（主 assistant 消息的正文）
 *  - run：耗时 / 工具数 / 状态元信息
 *
 * 这是消息渲染的唯一数据入口，取代原先散落在 chat-shell 的 buildRunGroups。
 * 纯函数、无副作用，便于独立验证。
 */
import type { AgentRunInfo, ChatMessage } from "@renderer/stores/conversation-store"
import { normalizeTodoStatus, type TodoStatus } from "./format"

export type { TodoStatus }

export interface PlanStepView {
  id: string
  description: string
  status: TodoStatus
}

/** turn 过程中的一个片段（按消息出现顺序） */
export type TurnProcessPart =
  | { kind: "thinking"; message: ChatMessage; thinking: string; streaming: boolean }
  | { kind: "tool"; message: ChatMessage }
  | { kind: "plan"; message: ChatMessage; steps: PlanStepView[] }
  | { kind: "error"; message: ChatMessage }
  | { kind: "text"; message: ChatMessage }

export type TurnStatus = "running" | "completed" | "failed" | "paused"

export interface TurnRunMeta {
  status: TurnStatus
  startedAt: number
  durationMs: number | null
  toolCallCount: number
}

export interface Turn {
  id: string
  /** 触发该轮的用户消息；历史/异常数据可能缺失 */
  user: ChatMessage | null
  /** 过程片段 */
  processParts: TurnProcessPart[]
  /** 最终回答：主 assistant 消息；运行中尚未产出正文时为 null */
  answer: ChatMessage | null
  /** 该轮 plan（取最后一条 plan 消息的 steps），供悬浮任务清单用 */
  plan: PlanStepView[] | null
  run: TurnRunMeta
  /** 是否正在运行（驱动实时耗时 / 默认展开 / 状态条） */
  running: boolean
  /** 是否有内容正在流式（任一片段 streaming） */
  streaming: boolean
}

function planStepsFromMessage(m: ChatMessage): PlanStepView[] | null {
  if (!m.plan?.steps?.length) return null
  return m.plan.steps.map((s) => ({
    id: s.id,
    description: s.description,
    status: normalizeTodoStatus(s.status),
  }))
}

function hasContent(m: ChatMessage): boolean {
  return typeof m.content === "string" && m.content.trim().length > 0
}

function hasThinking(m: ChatMessage): boolean {
  return typeof m.thinking === "string" && m.thinking.trim().length > 0
}

export function buildTurns(messages: ChatMessage[], runs: Record<string, AgentRunInfo>): Turn[] {
  const turns: Turn[] = []
  let current: { user: ChatMessage | null; items: ChatMessage[]; runId: string | null } | null = null

  const flush = () => {
    if (!current) return
    if (current.items.length === 0 && !current.user) {
      current = null
      return
    }
    turns.push(buildOneTurn(current.user, current.items, current.runId, runs))
    current = null
  }

  for (const m of messages) {
    if (m.role === "user") {
      flush()
      current = { user: m, items: [], runId: null }
    } else {
      if (!current) current = { user: null, items: [], runId: null }
      current.items.push(m)
      if (m.runId && !current.runId) current.runId = m.runId
    }
  }
  flush()
  return turns
}

function buildOneTurn(
  user: ChatMessage | null,
  items: ChatMessage[],
  runId: string | null,
  runs: Record<string, AgentRunInfo>,
): Turn {
  // 主 assistant：正在流式的那条优先；否则取最后一条有正文的 assistant
  const streamingAssistant = items.find((m) => m.role === "assistant" && (m.streaming || m.thinkingStreaming))
  const lastContentAssistant = [...items].reverse().find((m) => m.role === "assistant" && hasContent(m))
  const primary = streamingAssistant ?? lastContentAssistant ?? null

  // 运行中但主消息还没有正文 → 不挂 answer（过程里展示流式思考即可）
  let answer: ChatMessage | null = primary
  if (primary && !hasContent(primary) && (primary.streaming || primary.thinkingStreaming)) {
    answer = null
  }

  const processParts: TurnProcessPart[] = []
  let plan: PlanStepView[] | null = null

  for (const m of items) {
    if (m === primary) {
      // 主消息：思考归入过程，正文作为 answer（不进 processParts，避免重复渲染）
      if (hasThinking(m)) {
        processParts.push({
          kind: "thinking",
          message: m,
          thinking: m.thinking as string,
          streaming: !!m.thinkingStreaming,
        })
      }
      continue
    }
    switch (m.role) {
      case "tool":
        processParts.push({ kind: "tool", message: m })
        break
      case "plan": {
        const steps = planStepsFromMessage(m)
        if (steps) {
          processParts.push({ kind: "plan", message: m, steps })
          plan = steps
        }
        break
      }
      case "error":
        processParts.push({ kind: "error", message: m })
        break
      case "assistant":
        // 非主 assistant：有思考先记思考，有正文记文本
        if (hasThinking(m)) {
          processParts.push({
            kind: "thinking",
            message: m,
            thinking: m.thinking as string,
            streaming: !!m.thinkingStreaming,
          })
        }
        if (hasContent(m)) processParts.push({ kind: "text", message: m })
        break
      default:
        break
    }
  }
  // 兜底：plan 可能出现在主消息之后，取最后一条 plan
  if (!plan) {
    const lastPlan = [...items].reverse().find((m) => m.role === "plan")
    if (lastPlan) plan = planStepsFromMessage(lastPlan)
  }

  const realRun = runId ? runs[runId] : undefined
  const toolCallCount = processParts.filter((p) => p.kind === "tool").length
  const lastItemTs = items.length ? items[items.length - 1].createdAt : 0
  const startedAt = realRun?.startedAt ?? user?.createdAt ?? items[0]?.createdAt ?? Date.now()
  const isRunning = realRun?.status === "running" || items.some((m) => m.streaming || m.thinkingStreaming)
  const status: TurnStatus = realRun?.status ?? (isRunning ? "running" : "completed")
  const durationMs = realRun?.durationMs ?? (!isRunning && lastItemTs ? lastItemTs - startedAt : null)

  return {
    id: runId ?? user?.id ?? `turn-${startedAt}`,
    user,
    processParts,
    answer,
    plan,
    run: { status, startedAt, durationMs, toolCallCount },
    running: isRunning,
    streaming: items.some((m) => m.streaming || m.thinkingStreaming),
  }
}
