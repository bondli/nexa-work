/**
 * 会话与消息共享类型
 */

export type SessionMode = "free" | "project"
export type SessionStatus = "running" | "paused" | "completed" | "failed"

/** 会话摘要（session:list 回包） */
export interface SessionSummary {
  id: string
  title: string
  mode: SessionMode
  projectPath?: string | null
  status?: SessionStatus
  createdAt?: number
  updatedAt?: number
  currentExpert?: string | null
  model?: string
  archived?: boolean
  unread?: boolean
}

/** 消息条目（session:messages 回包） */
export interface ChatMessage {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: string
  createdAt?: number
  toolName?: string
  isError?: boolean
  /** 流式增量标记：assistant done 后置 true */
  done?: boolean
}

/** Agent 事件（透传自桌面端 pi-agent-core） */
export interface AgentEvent {
  type: string
  sessionId: string
  [key: string]: unknown
}

export interface PlanStep {
  id: string
  description: string
  status: "pending" | "active" | "done" | "failed"
}

/** 会话创建参数（桌面端 IPC + 中继 task:create 共用） */
export interface SessionCreateParams {
  initialMessage: string
  mode: SessionMode
  projectPath?: string
  model: string
  expertId?: string
}
