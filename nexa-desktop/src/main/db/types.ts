/**
 * SQLite 数据层接口契约
 * 所有表的 TypeScript 类型 + 数据访问层函数签名
 *
 * 原则：先冻结接口契约（此文件），再写 SQLite 实现
 * 上层 IPC handler 和 Agent Runtime 只依赖此文件，不依赖具体实现
 */
import type { ChatAttachment } from "@shared/ipc-channels"

// ==========================================
// 1. 会话 (sessions)
// ==========================================
export interface Session {
  id: string
  title: string
  /** free: 自由任务 | project: 项目编码 */
  mode: "free" | "project"
  /** running / paused / completed / failed */
  status: "running" | "paused" | "completed" | "failed"
  current_expert: string | null
  created_at: number
  updated_at: number
  /** free: ~/.nexa/workspaces/<id>/ | project: /path/to/project */
  workspace_path: string
  /** project 模式时记录原始项目根目录 */
  project_path: string | null
  model: string
  metadata: Record<string, unknown> | null
  /** 0 = 活跃, 1 = 已归档（轻量迁移字段，旧库自动补列） */
  archived: number
}

export interface SessionCreateInput {
  id: string
  title: string
  mode: "free" | "project"
  workspace_path: string
  project_path?: string | null
  model: string
  current_expert?: string | null
}

export interface SessionListFilter {
  mode?: "free" | "project"
  status?: "running" | "paused" | "completed" | "failed"
  search?: string
  /** true = 只看归档, false/undefined = 只看未归档 */
  archived?: boolean
}

// ==========================================
// 2. 消息 (messages)
// ==========================================
export interface Message {
  id: string
  session_id: string
  /** user / assistant / system / tool */
  role: "user" | "assistant" | "system" | "tool"
  content: string
  /** assistant 思考过程文本（reasoning 模型，如 DeepSeek R 系列） */
  thinking: string | null
  /** 用户消息图片附件（JSON 落库，读取时已反序列化）；非用户消息为 null */
  attachments: ChatAttachment[] | null
  tool_name: string | null
  tool_call_id: string | null
  /** 所属 agent run（一次用户消息触发的一轮 loop）；历史数据为 null */
  run_id: string | null
  created_at: number
  /** token 用量（JSON 落库，读取时已反序列化） */
  token_usage: { input?: number; output?: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number; cost?: number } | null
  /** assistant 实际使用的模型（provider/modelId）；历史数据为 null */
  model: string | null
}

// ==========================================
// 3. 工具调用 (tool_calls)
// ==========================================
export interface ToolCall {
  id: string
  session_id: string
  message_id: string | null
  tool_name: string
  args: Record<string, unknown>
  result: string | null
  success: 0 | 1
  duration_ms: number | null
  run_id: string | null
  created_at: number
}

/** Agent 一次完整运行（一条用户消息 → 一轮 agent loop），用于消息流「任务轨迹」收拢 */
export interface AgentRun {
  id: string
  session_id: string
  /** 毫秒时间戳（任务耗时需毫秒级精度，独立于全库秒级时间戳） */
  started_at: number
  finished_at: number | null
  duration_ms: number | null
  tool_call_count: number
  /** running / completed / failed / paused */
  status: "running" | "completed" | "failed" | "paused"
}

// ==========================================
// 4. 知识库 (knowledge_items)
// ==========================================
export interface KnowledgeItem {
  id: string
  type: "note" | "article" | "image" | "doc"
  title: string
  summary: string
  keywords: string[]
  tags: string[] | null
  source_url: string | null
  file_path: string
  workspace_id: string | null
  created_at: number
  updated_at: number
  embedding_hash: string | null
}

// ==========================================
// 5. 定时任务 (scheduled_jobs)
// ==========================================
export interface ScheduledJob {
  id: string
  description: string
  cron_expr: string
  handler_type: string
  handler_config: Record<string, unknown>
  enabled: 0 | 1
  last_run_at: number | null
  next_run_at: number | null
  last_result: string | null
  created_at: number
  created_by_session: string | null
}

// ==========================================
// 6. 定时任务执行记录 (job_runs)
// ==========================================
export interface JobRun {
  id: string
  job_id: string
  started_at: number
  finished_at: number | null
  success: 0 | 1
  output: string | null
  artifacts: string[] | null
  /** 本次运行实际使用的会话（session_continuation；会话被删后重建则为新会话 id） */
  session_id: string | null
}

// ==========================================
// 7. 记忆条目 (memory_items)
// ==========================================
export interface MemoryItem {
  id: string
  /** profile / state / preference */
  layer: "profile" | "state" | "preference"
  category: string
  content: string
  confidence: number
  source_session: string | null
  created_at: number
  updated_at: number
}

// ==========================================
// 8. 连接器调用记录 (connector_logs)
// ==========================================
export interface ConnectorLog {
  id: string
  connector_name: string
  endpoint: string
  success: 0 | 1
  latency_ms: number | null
  created_at: number
}

// ==========================================
// 9. 笔记 (notes)
// ==========================================
export interface Note {
  id: string
  title: string
  content: string
  /** draft | submitted */
  status: "draft" | "submitted"
  category: string
  tags: string[]
  linked_session: string | null
  created_at: number
  updated_at: number
}

export interface NoteCreateInput {
  id: string
  title: string
  content?: string
  status?: "draft" | "submitted"
  category?: string
  tags?: string[]
  linked_session?: string | null
}

export interface NoteUpdateInput {
  title?: string
  content?: string
  status?: "draft" | "submitted"
  category?: string
  tags?: string[]
}

export interface NoteListFilter {
  category?: string
  status?: "draft" | "submitted"
  search?: string
}

// ==========================================
// 10. 笔记分类 (note_categories)
// ==========================================
export interface NoteCategory {
  id: string
  name: string
  icon: string | null
  sort_order: number
  is_preset: 0 | 1
  created_at: number
}

export interface NoteCategoryWithCount extends NoteCategory {
  note_count: number
}

// ==========================================
// 数据访问层函数签名
// ==========================================

/** Session 数据访问 */
export interface SessionDAO {
  create(input: SessionCreateInput): Session
  get(id: string): Session | undefined
  list(filter?: SessionListFilter): Session[]
  updateStatus(id: string, status: Session["status"]): void
  setCurrentExpert(id: string, expertId: string): void
  rename(id: string, title: string): void
  setModel(id: string, model: string): void
  setArchived(id: string, archived: boolean): void
  delete(id: string): void
}

/** Note 数据访问 */
export interface NoteDAO {
  create(input: NoteCreateInput): Note
  get(id: string): Note | undefined
  list(filter?: NoteListFilter): Note[]
  update(id: string, patch: NoteUpdateInput): Note | undefined
  delete(id: string): void
}

/** NoteCategory 数据访问 */
export interface NoteCategoryDAO {
  listWithCount(): NoteCategoryWithCount[]
  create(name: string, icon?: string): NoteCategory
  remove(id: string): void
}

/** Message 数据访问（Agent Runtime 持久化 + 历史加载） */
export interface MessageDAO {
  insertUser(sessionId: string, content: string, attachments?: ChatAttachment[]): void
  insertAssistant(sessionId: string, content: string, tokenUsage: unknown, thinking?: string, runId?: string | null, model?: string | null): void
  /** 工具调用完成后，往 messages 表补一条 tool role 消息（用于历史加载恢复 ToolCallBubble） */
  insertTool(sessionId: string, toolName: string, callId: string, result: unknown, success: boolean, durationMs: number | null, args?: unknown, runId?: string | null): void
  listBySession(sessionId: string): Message[]
}

/** ToolCall 数据访问（Agent Runtime 持久化） */
export interface ToolCallDAO {
  insert(id: string, sessionId: string, toolName: string, args: unknown, runId?: string | null): void
  updateResult(id: string, result: unknown, success: boolean, durationMs: number): void
}

/** Agent Run 数据访问（消息流「任务轨迹」收拢） */
export interface AgentRunDAO {
  create(id: string, sessionId: string, startedAt: number): void
  finish(id: string, status: AgentRun["status"], finishedAt: number, durationMs: number, toolCallCount: number): void
  listBySession(sessionId: string): AgentRun[]
}

/** 知识库条目数据访问 */
export interface KnowledgeDAO {
  create(input: Omit<KnowledgeItem, "created_at" | "updated_at">): KnowledgeItem
  get(id: string): KnowledgeItem | undefined
  list(opts?: { type?: KnowledgeItem["type"]; limit?: number }): KnowledgeItem[]
  /** SQLite 粗筛：title/summary/tags/keywords 模糊匹配，返回候选（上限 30 条交给 LLM 重排） */
  coarseSearch(opts: { query: string; type?: KnowledgeItem["type"]; limit?: number }): KnowledgeItem[]
  findBySourceUrl(url: string): KnowledgeItem | undefined
  findByTitle(title: string): KnowledgeItem | undefined
  delete(id: string): void
}

/** 定时任务创建入参（handler_config 创建后不可变，只有 enabled/next_run_at/last_* 会更新） */
export interface ScheduledJobCreateInput {
  description: string
  cron_expr: string
  handler_type: "script" | "skill" | "session_continuation"
  handler_config: Record<string, unknown>
  enabled?: 0 | 1
  next_run_at?: number | null
  created_by_session?: string | null
}

/** 定时任务数据访问 */
export interface ScheduledJobDAO {
  create(input: ScheduledJobCreateInput): ScheduledJob
  get(id: string): ScheduledJob | undefined
  listAll(): ScheduledJob[]
  listEnabled(): ScheduledJob[]
  setEnabled(id: string, enabled: 0 | 1, nextRunAt: number | null): void
  /** 执行后更新 last_run_at / last_result / next_run_at */
  recordRun(id: string, lastRunAt: number, lastResult: string | null, nextRunAt: number | null): void
  /** 会话被删重建后写回 handler_config（更新 sessionId） */
  updateHandlerConfig(id: string, config: Record<string, unknown>): void
  delete(id: string): void
}

/** 定时任务执行记录数据访问 */
export interface JobRunDAO {
  /** 创建一条 started 记录，返回 run id */
  start(jobId: string): string
  complete(id: string, success: boolean, output: string | null, artifacts?: string[] | null, sessionId?: string | null): void
  listByJob(jobId: string, limit?: number): JobRun[]
  /** 全部任务的执行记录（按 started_at 倒序，分页），供「运行记录」列表使用 */
  listAll(limit?: number, offset?: number): JobRun[]
  /** 某 job 的总执行次数 */
  countByJob(jobId: string): number
  /** 今日成功+失败总数 */
  countToday(): number
  countAll(): number
}

/** 记忆条目数据访问（同 layer+category 硬删除覆盖） */
export interface MemoryDAO {
  upsert(input: Omit<MemoryItem, "id" | "created_at" | "updated_at"> & { id?: string }): MemoryItem
  get(id: string): MemoryItem | undefined
  list(filter?: { layer?: MemoryItem["layer"]; minConfidence?: number }): MemoryItem[]
  update(id: string, patch: Partial<Pick<MemoryItem, "content" | "confidence" | "category" | "layer">>): MemoryItem | undefined
  delete(id: string): void
}

/** 数据库主入口 */
export interface Database {
  session: SessionDAO
  message: MessageDAO
  toolCall: ToolCallDAO
  agentRun: AgentRunDAO
  note: NoteDAO
  noteCategory: NoteCategoryDAO
  knowledge: KnowledgeDAO
  memory: MemoryDAO
  scheduledJob: ScheduledJobDAO
  jobRun: JobRunDAO
  close(): void
}
