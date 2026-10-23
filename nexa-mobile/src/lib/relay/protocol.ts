/**
 * 中继消息协议类型 —— 与桌面端 / nexa-relay 保持一致
 */

export type RelayRole = "desktop" | "phone"

export interface RelaySender {
  deviceId: string
  name: string
  role: RelayRole
}

/** 通用消息信封 */
export interface RelayEnvelope<P = unknown> {
  type: string
  id?: string
  timestamp?: number
  to?: string
  payload?: P
  sender?: RelaySender
}

/** 桌面端已配对设备 */
export interface PairedPeer {
  deviceId: string
  name: string
  role: RelayRole
}

/** 会话摘要（来自 session:list 回包，字段对齐桌面 IPC SESSION_LIST） */
export interface SessionSummary {
  id: string
  title: string
  mode: "free" | "project"
  projectPath?: string | null
  status?: string
  createdAt?: number
  updatedAt?: number
  expertId?: string | null
  model?: string
  unread?: boolean
  /** 是否已归档（桌面端 session.archived） */
  archived?: boolean
}

/** 消息图片附件（session:messages 下发；dataUrl 由桌面端读取落盘文件转换，超限时为 null） */
export interface ChatMessageAttachment {
  name: string
  mimeType: string
  dataUrl?: string | null
}

/** token 用量（桌面端 token_usage 反序列化后下发 / assistant.done 事件） */
export interface TokenUsage {
  input?: number
  output?: number
  totalTokens?: number
  cacheRead?: number
  cacheWrite?: number
}

/** 消息条目（session:messages 回包） */
export interface ChatMessage {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: string
  createdAt?: number
  toolName?: string
  isError?: boolean
  /** assistant 思考过程（reasoning 模型，如 DeepSeek R 系列） */
  thinking?: string | null
  /** 流式增量标记：assistant done 后置 true */
  done?: boolean
  /** 所属任务轨迹（agent_runs.id）；历史数据为 null */
  runId?: string | null
  /** assistant 使用的模型标识 provider/modelId */
  model?: string | null
  /** assistant token 用量（消息底栏展示） */
  usage?: TokenUsage | null
  /** 用户消息携带的图片附件 */
  attachments?: ChatMessageAttachment[]
}

/** 任务轨迹（agent_runs，session.runs 回包） */
export interface AgentRunSummary {
  id: string
  /** 毫秒时间戳 */
  started_at: number
  finished_at: number | null
  duration_ms: number | null
  tool_call_count: number
  status: "running" | "completed" | "failed" | "paused"
}

/** Agent 事件（透传自桌面端 pi-agent-core，结构对齐 ipc-channels AgentEvent） */
export interface AgentEvent {
  type: string
  sessionId: string
  [key: string]: unknown
}

// ===== 系统消息类型 =====
export const RELAY_HELLO = "relay:hello"
export const RELAY_PAIRED = "relay:paired"
export const RELAY_PEER_ONLINE = "relay:peer-online"
export const RELAY_PEER_OFFLINE = "relay:peer-offline"
export const RELAY_UNBOUND = "relay:unbound"
export const RELAY_PING = "relay:ping"
export const RELAY_PONG = "relay:pong"
export const RELAY_ERROR = "relay:error"

// ===== 业务消息类型 =====
export const TASK_CREATE = "task:create"
export const SESSION_SEND = "session:send"
export const SESSION_PAUSE = "session:pause"
export const SESSION_RESUME = "session:resume"
export const SESSION_LIST = "session:list"
export const SESSION_MESSAGES = "session:messages"
export const AGENT_EVENT = "agent:event"
export const SCHEDULER_NOTIFY = "scheduler:notify"
export const LIBRARY_SEARCH = "library:search"

// ===== 手机端新增 RPC =====
export const SCHEDULE_LIST = "schedule.list"
export const SCHEDULE_RUNS = "schedule.runs"
export const LIBRARY_LIST = "library.list"
export const LIBRARY_ITEM = "library.item"

/** 会话消息图片附件（手机端 + 号选图发送；dataUrl 由桌面端落盘 ~/.nexa/uploads） */
export interface ImageAttachmentInput {
  name: string
  mimeType: string
  /** data:image/jpeg;base64,... */
  dataUrl: string
}

/** 任务产物文档（session.artifacts 回包，来自任务 workspace 的 md/html） */
export interface ArtifactItem {
  relPath: string
  name: string
  mtime: number
  size: number
}

/** 定时任务（字段对齐桌面 DB scheduled_jobs） */
export interface ScheduledJobSummary {
  id: string
  description: string
  cron_expr: string
  handler_type: string
  enabled: 0 | 1
  last_run_at: number | null
  next_run_at: number | null
  last_result: string | null
  created_at: number
}

/** 定时任务执行记录（字段对齐桌面 DB job_runs） */
export interface JobRunSummary {
  id: string
  job_id: string
  started_at: number
  finished_at: number | null
  success: 0 | 1
  output: string | null
  session_id: string | null
}

/** 知识库条目（字段对齐桌面 DB knowledge_items） */
export interface LibraryItemSummary {
  id: string
  title: string
  summary?: string | null
  type: string
  source_url?: string | null
  content?: string | null
  /** 图片条目详情：原图 dataURL（library.item 返回） */
  dataUrl?: string | null
  created_at?: number
  updated_at?: number
}

/** 资料库搜索结果条目 */
export interface LibrarySearchResult {
  id: string
  title: string
  summary?: string
  type: string
}
