/**
 * IPC 通道名常量 - 主进程与渲染进程共享
 * 渲染进程 → 主进程 (invoke) 和 主进程 → 渲染进程 (event)
 */

// ===== 渲染进程 → 主进程 (invoke) =====
export const IPC = {
  // 会话管理
  SESSION_CREATE: "agent:session.create",
  SESSION_SEND: "agent:session.send",
  SESSION_PAUSE: "agent:session.pause",
  SESSION_RESUME: "agent:session.resume",
  SESSION_DELETE: "agent:session.delete",
  HUMAN_RESPONSE: "agent:human-response",
  SESSION_LIST: "agent:list",
  SESSION_MESSAGES: "agent:session.messages",
  SESSION_RUNS: "agent:session.runs",
  SESSION_RENAME: "agent:session.rename",
  SESSION_ARCHIVE: "agent:session.archive",
  SESSION_REVEAL: "agent:session.reveal",
  OPEN_DIRECTORY_PICKER: "agent:open-directory-picker",
  WORKSPACE_LIST: "agent:workspace.list",
  WORKSPACE_READ: "agent:workspace.read",
  ARTIFACT_PREVIEW_BASE: "agent:workspace.preview-base",
  ATTACHMENT_READ: "agent:attachment.read",

  // 笔记
  NOTE_LIST: "note:list",
  NOTE_GET: "note:get",
  NOTE_CREATE: "note:create",
  NOTE_UPDATE: "note:update",
  NOTE_DELETE: "note:delete",
  NOTE_CATEGORIES: "note:categories",
  NOTE_ADD_CATEGORY: "note:addCategory",
  NOTE_REMOVE_CATEGORY: "note:removeCategory",

  // 知识库 (M4)
  KB_LIST: "kb:list",
  KB_GET: "kb:get",
  KB_SEARCH: "kb:search",
  KB_ADD_NOTE: "kb:addNote",
  KB_ADD_ARTICLE: "kb:addArticle",
  KB_ADD_IMAGE: "kb:addImage",
  KB_ADD_DOC: "kb:addDoc",
  KB_DELETE: "kb:delete",
  /** 按条目 id 读取图片原图（dataURL），供资料库缩略图与大图预览 */
  KB_IMAGE_READ: "kb:imageRead",

  // 记忆 (M4)
  MEMORY_LIST: "memory:list",
  MEMORY_UPSERT: "memory:upsert",
  MEMORY_UPDATE: "memory:update",
  MEMORY_DELETE: "memory:delete",

  // 定时任务 (M5)
  JOB_LIST: "job:list",
  JOB_TOGGLE: "job:toggle",
  JOB_DELETE: "job:delete",
  JOB_RUN_NOW: "job:runNow",
  JOB_RUNS: "job:runs",
  JOB_STATS: "job:stats",

  // 手机中继 (M5b)
  RELAY_STATUS: "relay:status",
  RELAY_SET_URL: "relay:setUrl",
  RELAY_CREATE_PAIRING: "relay:createPairing",
  RELAY_UNBIND: "relay:unbind",

  // 系统设置
  GET_THEME: "theme:get",
  SET_THEME: "theme:set",
  GET_SETTINGS: "settings:get",
  SET_SETTINGS: "settings:set",

  // 通知设置
  /** 打开 macOS 系统「通知」偏好设置面板 */
  OPEN_NOTIFICATION_SETTINGS: "notify:open-system-settings",
  /** 在系统文件管理器中打开任意绝对路径（Finder / Explorer） */
  OPEN_FOLDER: "fs:open-folder",

  // 专家
  EXPERT_LIST: "expert:list",
  SESSION_SET_EXPERT: "agent:session.set-expert",
  SESSION_SET_MODEL: "agent:session.set-model",

  // Skill
  SKILL_LIST: "skill:list",
  SKILL_TOGGLE: "skill:toggle",

  // 连接器
  CONNECTOR_LIST: "connector:list",
  CONNECTOR_TEST: "connector:test",
  CONNECTOR_GET: "connector:get",
  CONNECTOR_SAVE: "connector:save",
  CONNECTOR_DELETE: "connector:delete",

  // 专家管理
  EXPERT_GET: "expert:get",
  EXPERT_SAVE: "expert:save",
  EXPERT_DELETE: "expert:delete",

  // Skill 管理
  SKILL_GET: "skill:get",
  SKILL_SAVE: "skill:save",
  SKILL_DELETE: "skill:delete",
} as const

// ===== 主进程 → 渲染进程 (event) =====
export const AGENT_EVENT = "agent:event"

/** 中继状态变化事件（M5b） */
export const RELAY_EVENT = "relay:event"

/** 桌面通知已弹出事件（主进程 → 渲染进程）：渲染端据此播放提示音 */
export const NOTIFY_EVENT = "notify:event"

/** NOTIFY_EVENT 载荷 */
export interface NoticeEvent {
  title: string
  body: string
  /** 提示音名称（settings.notificationSound）；「静音」= 不播放 */
  sound: string
}

/** 已配对手机设备 */
export interface PairedDevice {
  deviceId: string
  name: string
  pairedAt: number
  online: boolean
}

/** 待确认配对码 */
export interface PendingPairing {
  code: string
  expiresAt: number
}

/** 中继连接完整状态（RELAY_STATUS 返回 + RELAY_EVENT 推送） */
export interface RelayStatus {
  connected: boolean
  /** 本机设备 ID（未配置中继时也有值） */
  deviceId: string
  deviceName: string
  /** 当前中继基址（可能为空串） */
  relayUrl: string
  pendingPairing: PendingPairing | null
  paired: PairedDevice[]
  /** 最近一条错误（连接失败/配对失败等），成功连接后清空 */
  lastError: string | null
}

// ===== 模型定义 =====
export interface ModelInfo {
  /** provider/modelId */
  id: string
  displayName: string
  provider: string
  modelId: string
}

/** GET_SETTINGS 返回 */
export interface NexaSettingsResponse {
  defaultModel: string
  /** 可用模型列表（硬编码的常用模型） */
  availableModels: ModelInfo[]
  /** 当前配置的 API key（provider → key，空字符串表示未配置） */
  apiKeys: Record<string, string>
  /** 是否已完成初始化向导 */
  initialized: boolean
  /** 用户名 */
  userName: string
  /** 主题偏好 */
  theme: "system" | "light" | "dark"
}

/** SET_SETTINGS 请求 */
export interface NexaSettingsUpdate {
  /** 默认模型 "provider/modelId" */
  defaultModel?: string
  /** API key 更新（undefined 表示不修改） */
  apiKeys?: Record<string, string>
  /** 是否已完成初始化向导 */
  initialized?: boolean
  /** 用户名 */
  userName?: string
  /** 主题偏好 */
  theme?: "system" | "light" | "dark"
}

// ===== 会话模式 =====
export type SessionMode = "free" | "project"

// ===== 专家（渲染进程可见信息，不含 systemPrompt） =====
export interface ExpertDispatchStrategy {
  maxSteps?: number
  allowParallel?: boolean
  stepTimeoutSeconds?: number
  memoryProfile?: "concise" | "detail" | "full"
}

export interface ExpertInfo {
  id: string
  name: string
  description: string
  tools?: string[]
  disallowTools?: string[]
  dispatchStrategy?: ExpertDispatchStrategy
  builtin: boolean
}

// ===== Skill =====
export interface SkillInputSpec {
  name: string
  type?: string
  required?: boolean
  description?: string
  default?: string
}

export interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  inputs: SkillInputSpec[]
  outputs: string[]
  promptHint?: string
  builtin: boolean
  enabled: boolean
}

// ===== 连接器 =====
export interface ConnectorEndpoint {
  name: string
  method: string
  path: string
}

export interface ConnectorInfo {
  id: string
  displayName: string
  type: string
  baseUrl: string
  endpoints: ConnectorEndpoint[]
  /** 是否配置了 secrets（不外泄值） */
  hasSecrets: boolean
  secretKeys: string[]
  /** 是否内置（随应用提供，不可删除，可编辑凭据） */
  builtin: boolean
}

export interface ConnectorTestResult {
  ok: boolean
  message: string
  status?: number
  latencyMs?: number
}

// ===== 管理页详情 =====
/** 专家保存参数（id 省略 = 新建，id 由 name 生成） */
export interface ExpertSaveParams {
  id?: string
  name: string
  description: string
  systemPrompt: string
  tools?: string[]
  disallowTools?: string[]
}

/** 专家详情（含 systemPrompt，编辑用） */
export interface ExpertDetail extends ExpertInfo {
  systemPrompt: string
}

/** Skill 详情（yaml 为 skill.yaml 原文） */
export interface SkillDetail extends SkillInfo {
  yaml: string
}

/** 连接器详情（yaml 原文；secrets 值为 enc: 密文或用户明文） */
export interface ConnectorDetail extends ConnectorInfo {
  yaml: string
}

// ===== 会话状态 =====
export type SessionStatus = "running" | "paused" | "completed" | "failed"

// ===== 消息附件（粘贴/拖拽图片） =====
/** 已落盘的附件（主进程写入 ~/.nexa/uploads/<sessionId>/，随消息持久化） */
export interface ChatAttachment {
  /** 磁盘绝对路径 */
  path: string
  name: string
  mimeType: string
  size: number
}

/** 渲染端提交的附件（dataURL，主进程负责落盘） */
export interface AttachmentInput {
  name: string
  mimeType: string
  /** data:image/png;base64,... */
  dataUrl: string
}

// ===== 创建会话参数 =====
export interface SessionCreateParams {
  initialMessage: string
  mode: SessionMode
  projectPath?: string
  model: string
  expertId?: string
  /** 首条消息携带的图片附件 */
  attachments?: AttachmentInput[]
}

// ===== 会话列表项 =====
export interface SessionListItem {
  id: string
  title: string
  mode: SessionMode
  status: SessionStatus
  currentExpert: string | null
  projectPath: string | null
  createdAt: number
  updatedAt: number
  /** 会话创建时使用的模型 provider/modelId */
  model: string
  /** 是否已归档 */
  archived: boolean
}

// ===== 工作区文件（产物面板） =====
/** workspace.list 返回的文件树节点 */
export interface WorkspaceFileNode {
  name: string
  /** 相对 workspace 根的路径（如 "src/index.ts"） */
  path: string
  type: "file" | "directory"
  /** 文件大小 bytes（仅 file） */
  size?: number
  children?: WorkspaceFileNode[]
}

/** workspace.read 返回 */
export interface WorkspaceReadResponse {
  path: string
  /** utf-8 文本内容；二进制文件为 null */
  content: string | null
  /** 是否图片（渲染进程用 <img> 展示） */
  isImage: boolean
  /** 图片 dataURL（仅图片文件） */
  dataUrl?: string
  size: number
}

// ===== Agent 事件类型 (主进程推送) =====
export type AgentEvent =
  | { type: "session.created"; sessionId: string; title: string; mode: SessionMode }
  | { type: "session.title"; sessionId: string; title: string }
  | { type: "session.status"; sessionId: string; status: SessionStatus }
  | { type: "run.started"; sessionId: string; runId: string; ts: number }
  | {
      type: "run.finished"
      sessionId: string
      runId: string
      status: "completed" | "failed" | "paused"
      durationMs: number
      toolCallCount: number
    }
  | { type: "session.expert-switch"; sessionId: string; from: string; to: string }
  | { type: "session.model-switch"; sessionId: string; model: string }
  | { type: "message.user"; sessionId: string; id: string; content: string; ts: number; attachments?: ChatAttachment[] }
  | { type: "message.thinking.delta"; sessionId: string; id: string; delta: string }
  | { type: "message.assistant.delta"; sessionId: string; id: string; delta: string }
  | { type: "message.assistant.done"; sessionId: string; id: string; content: string; thinking?: string }
  | { type: "plan.created"; sessionId: string; steps: PlanStep[] }
  | {
      type: "plan.step.update"
      sessionId: string
      stepIndex: number
      status: "pending" | "active" | "done" | "failed"
    }
  | { type: "tool.call"; sessionId: string; toolName: string; args: unknown; callId: string; ts: number }
  | {
      type: "tool.result"
      sessionId: string
      callId: string
      success: boolean
      result: unknown
      durationMs: number
    }
  | { type: "human-ask"; sessionId: string; questionId: string; question: string; options: string[] }
  | { type: "human-ask.resolved"; sessionId: string; questionId: string }
  | { type: "artifact.created"; sessionId: string; file: { icon: string; title: string; desc: string; size: string } }
  | { type: "workspace.files.changed"; sessionId: string }
  | { type: "error"; sessionId?: string; code: string; message: string }

export interface PlanStep {
  id: string
  description: string
  status: "pending" | "active" | "done" | "failed"
}
