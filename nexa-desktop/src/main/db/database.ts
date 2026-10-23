import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js"
import type {
  Session,
  SessionCreateInput,
  SessionListFilter,
  SessionDAO,
  Message,
  MessageDAO,
  ToolCallDAO,
  Note,
  NoteCreateInput,
  NoteUpdateInput,
  NoteListFilter,
  NoteDAO,
  NoteCategory,
  NoteCategoryWithCount,
  NoteCategoryDAO,
  KnowledgeItem,
  KnowledgeDAO,
  MemoryItem,
  MemoryDAO,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobDAO,
  JobRun,
  JobRunDAO,
  AgentRun,
  AgentRunDAO,
  Database as IDatabase,
} from "./types"
import type { ChatAttachment } from "@shared/ipc-channels"

/** 用户数据目录: ~/.nexa/ */
export function getUserDataDir(): string {
  return join(homedir(), ".nexa")
}

/** 数据库文件路径: ~/.nexa/nexa.db */
export function getDatabasePath(): string {
  return join(getUserDataDir(), "nexa.db")
}

// ==========================================
// sql.js 初始化 + 文件持久化封装
// ==========================================

let sqlPromise: ReturnType<typeof initSqlJs> | null = null

/** 获取 sql.js SQL 构造器（全局单例初始化一次） */
async function getSQL(): Promise<initSqlJs.SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs()
  }
  return sqlPromise
}

/** sql.js 没有 WAL，用 SQLite journal_mode=DELETE 替代 */
const PRAGMA_SETUP = `PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;`

/**
 * 打开数据库：从文件读取 → 创建 sql.js Database → 执行 PRAGMA
 * 不存在则创建新库 + 执行 schema
 */
function openDb(SQL: initSqlJs.SqlJsStatic, dbPath: string): SqlJsDatabase {
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    const db = new SQL.Database(buffer)
    db.exec(PRAGMA_SETUP)
    return db
  }
  const db = new SQL.Database()
  db.exec(PRAGMA_SETUP)
  return db
}

/** 保存数据库：db.export() → 写文件 */
function saveDb(db: SqlJsDatabase, dbPath: string): void {
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

/** 执行 SQL (可能含多条) */
function exec(db: SqlJsDatabase, sql: string): void {
  db.run(sql)
}

/** 执行带参数的单条 SQL */
function run(db: SqlJsDatabase, sql: string, params: unknown[] = []): void {
  db.run(sql, params as number[] | string[] | Uint8Array[])
}

/** 查询多行 */
function query<T = Record<string, unknown>>(
  db: SqlJsDatabase,
  sql: string,
  params: unknown[] = []
): T[] {
  const stmt = db.prepare(sql)
  stmt.bind(params as number[] | string[] | Uint8Array[])
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

/** 查询单行 */
function queryOne<T = Record<string, unknown>>(
  db: SqlJsDatabase,
  sql: string,
  params: unknown[] = []
): T | undefined {
  const rows = query<T>(db, sql, params)
  return rows[0]
}

/** 从 TEXT 列解析 JSON */
function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/** 对象序列化为 TEXT */
function toJson(value: unknown): string {
  if (value === null || value === undefined) return ""
  return JSON.stringify(value)
}

// ==========================================
// 内联 Schema SQL (单文件 migration)
// ==========================================
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  current_expert TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,
  project_path TEXT,
  model TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  thinking TEXT,
  attachments TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  token_usage TEXT,
  model TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  tool_name TEXT NOT NULL,
  args TEXT NOT NULL,
  result TEXT,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords TEXT NOT NULL,
  tags TEXT,
  source_url TEXT,
  file_path TEXT NOT NULL,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  embedding_hash TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  handler_type TEXT NOT NULL,
  handler_config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_result TEXT,
  created_at INTEGER NOT NULL,
  created_by_session TEXT,
  FOREIGN KEY (created_by_session) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  success INTEGER NOT NULL,
  output TEXT,
  artifacts TEXT,
  session_id TEXT,
  FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id)
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_session TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (source_session) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS connector_logs (
  id TEXT PRIMARY KEY,
  connector_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  success INTEGER NOT NULL,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  category TEXT NOT NULL DEFAULT '未分类',
  tags TEXT NOT NULL DEFAULT '[]',
  linked_session TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (linked_session) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS note_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_preset INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_items(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON scheduled_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_memory_layer ON memory_items(layer);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

INSERT OR IGNORE INTO note_categories (id, name, icon, sort_order, is_preset, created_at) VALUES
  ('cat-meeting', '会议', '📋', 0, 1, strftime('%s','now')),
  ('cat-learning', '学习', '📚', 1, 1, strftime('%s','now')),
  ('cat-work', '工作', '💼', 2, 1, strftime('%s','now')),
  ('cat-idea', '灵感', '💡', 3, 1, strftime('%s','now')),
  ('cat-uncategorized', '未分类', '📁', 4, 1, strftime('%s','now'));
`

// ==========================================
// DAO 实现
// ==========================================

/** 包装 sql.js Database，提供自动持久化 */
class DbHandle {
  constructor(
    private SQL: initSqlJs.SqlJsStatic,
    private dbPath: string,
    private db: SqlJsDatabase
  ) {}
  static open(SQL: initSqlJs.SqlJsStatic, dbPath: string): DbHandle {
    const db = openDb(SQL, dbPath)
    return new DbHandle(SQL, dbPath, db)
  }
  exec(sql: string): void {
    this.db.exec(sql)
  }
  run(sql: string, params: unknown[] = []): void {
    run(this.db, sql, params)
    saveDb(this.db, this.dbPath)
  }
  query<T>(sql: string, params: unknown[] = []): T[] {
    return query<T>(this.db, sql, params)
  }
  queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    return queryOne<T>(this.db, sql, params)
  }
  commit(): void {
    saveDb(this.db, this.dbPath)
  }
  close(): void {
    saveDb(this.db, this.dbPath)
    this.db.close()
  }
}

function createSessionDAO(db: DbHandle): SessionDAO {
  return {
    create(input: SessionCreateInput): Session {
      const now = Math.floor(Date.now() / 1000)
      db.run(
        `INSERT INTO sessions (id, title, mode, status, current_expert, created_at, updated_at, workspace_path, project_path, model, metadata)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, NULL)`,
        [
          input.id,
          input.title,
          input.mode,
          input.current_expert ?? null,
          now,
          now,
          input.workspace_path,
          input.project_path ?? null,
          input.model,
        ]
      )
      return db.queryOne<Session>("SELECT * FROM sessions WHERE id = ?", [input.id])!
    },

    get(id: string): Session | undefined {
      return db.queryOne<Session>("SELECT * FROM sessions WHERE id = ?", [id])
    },

    list(filter?: SessionListFilter): Session[] {
      const where: string[] = []
      const params: unknown[] = []
      if (filter?.mode) {
        where.push("mode = ?")
        params.push(filter.mode)
      }
      if (filter?.status) {
        where.push("status = ?")
        params.push(filter.status)
      }
      if (filter?.search) {
        where.push("title LIKE ?")
        params.push(`%${filter.search}%`)
      }
      // 归档过滤: 默认只看未归档
      where.push("archived = ?")
      params.push(filter?.archived ? 1 : 0)
      const sql = `SELECT * FROM sessions
        ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY updated_at DESC`
      return db.query<Session>(sql, params)
    },

    updateStatus(id: string, status: Session["status"]): void {
      db.run("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?", [
        status,
        Math.floor(Date.now() / 1000),
        id,
      ])
    },

    setCurrentExpert(id: string, expertId: string): void {
      db.run("UPDATE sessions SET current_expert = ?, updated_at = ? WHERE id = ?", [
        expertId,
        Math.floor(Date.now() / 1000),
        id,
      ])
    },

    rename(id: string, title: string): void {
      db.run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [
        title,
        Math.floor(Date.now() / 1000),
        id,
      ])
    },

    setModel(id: string, model: string): void {
      db.run("UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?", [
        model,
        Math.floor(Date.now() / 1000),
        id,
      ])
    },

    setArchived(id: string, archived: boolean): void {
      db.run("UPDATE sessions SET archived = ?, updated_at = ? WHERE id = ?", [
        archived ? 1 : 0,
        Math.floor(Date.now() / 1000),
        id,
      ])
    },

    delete(id: string): void {
      db.run("DELETE FROM tool_calls WHERE session_id = ?", [id])
      db.run("DELETE FROM messages WHERE session_id = ?", [id])
      db.run("DELETE FROM job_runs WHERE job_id IN (SELECT id FROM scheduled_jobs WHERE created_by_session = ?)", [id])
      db.run("DELETE FROM scheduled_jobs WHERE created_by_session = ?", [id])
      // 知识库条目（金句/文章/图片/文档）与笔记是用户资产，由 Agent 工具入库，不随任务删除
      db.run("DELETE FROM sessions WHERE id = ?", [id])
    },
  }
}

function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    title: row.title as string,
    content: (row.content as string) ?? "",
    status: (row.status as "draft" | "submitted") ?? "draft",
    category: (row.category as string) ?? "未分类",
    tags: parseJson<string[]>(row.tags as string) ?? [],
    linked_session: (row.linked_session as string) ?? null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  }
}

function createNoteDAO(db: DbHandle): NoteDAO {
  return {
    create(input: NoteCreateInput): Note {
      const now = Math.floor(Date.now() / 1000)
      db.run(
        `INSERT INTO notes (id, title, content, status, category, tags, linked_session, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.title,
          input.content ?? "",
          input.status ?? "draft",
          input.category ?? "未分类",
          toJson(input.tags ?? []),
          input.linked_session ?? null,
          now,
          now,
        ]
      )
      const row = db.queryOne<Record<string, unknown>>("SELECT * FROM notes WHERE id = ?", [input.id])
      return rowToNote(row!)
    },

    get(id: string): Note | undefined {
      const row = db.queryOne<Record<string, unknown>>("SELECT * FROM notes WHERE id = ?", [id])
      return row ? rowToNote(row) : undefined
    },

    list(filter?: NoteListFilter): Note[] {
      const where: string[] = []
      const params: unknown[] = []
      if (filter?.category) {
        where.push("category = ?")
        params.push(filter.category)
      }
      if (filter?.status) {
        where.push("status = ?")
        params.push(filter.status)
      }
      if (filter?.search) {
        where.push("(title LIKE ? OR content LIKE ?)")
        params.push(`%${filter.search}%`, `%${filter.search}%`)
      }
      const sql = `SELECT * FROM notes
        ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY updated_at DESC`
      const rows = db.query<Record<string, unknown>>(sql, params)
      return rows.map(rowToNote)
    },

    update(id: string, patch: NoteUpdateInput): Note | undefined {
      const sets: string[] = []
      const params: unknown[] = []
      if (patch.title !== undefined) {
        sets.push("title = ?")
        params.push(patch.title)
      }
      if (patch.content !== undefined) {
        sets.push("content = ?")
        params.push(patch.content)
      }
      if (patch.status !== undefined) {
        sets.push("status = ?")
        params.push(patch.status)
      }
      if (patch.category !== undefined) {
        sets.push("category = ?")
        params.push(patch.category)
      }
      if (patch.tags !== undefined) {
        sets.push("tags = ?")
        params.push(toJson(patch.tags))
      }
      if (sets.length === 0) return this.get(id)

      sets.push("updated_at = ?")
      params.push(Math.floor(Date.now() / 1000))
      params.push(id)

      db.run(`UPDATE notes SET ${sets.join(", ")} WHERE id = ?`, params)
      return this.get(id)
    },

    delete(id: string): void {
      db.run("DELETE FROM notes WHERE id = ?", [id])
    },
  }
}

function createNoteCategoryDAO(db: DbHandle): NoteCategoryDAO {
  return {
    listWithCount(): NoteCategoryWithCount[] {
      return db.query<NoteCategoryWithCount>(
        `SELECT nc.id, nc.name, nc.icon, nc.sort_order, nc.is_preset, nc.created_at,
                COUNT(n.id) AS note_count
         FROM note_categories nc
         LEFT JOIN notes n ON n.category = nc.name
         GROUP BY nc.id
         ORDER BY nc.sort_order ASC`
      )
    },

    create(name: string, icon?: string): NoteCategory {
      const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const now = Math.floor(Date.now() / 1000)
      const exists = db.queryOne<{ id: string }>("SELECT id FROM note_categories WHERE name = ?", [name])
      if (exists) {
        throw new Error(`分类「${name}」已存在`)
      }
      db.run(
        `INSERT INTO note_categories (id, name, icon, sort_order, is_preset, created_at)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM note_categories), 0, ?)`,
        [id, name, icon ?? null, now]
      )
      return db.queryOne<NoteCategory>("SELECT * FROM note_categories WHERE id = ?", [id])!
    },

    remove(id: string): void {
      const cat = db.queryOne<NoteCategory>("SELECT * FROM note_categories WHERE id = ?", [id])
      if (!cat) return
      if (cat.is_preset === 1) return
      db.run("UPDATE notes SET category = '未分类' WHERE category = ?", [cat.name])
      db.run("DELETE FROM note_categories WHERE id = ?", [id])
    },
  }
}

// ==========================================
// Message / ToolCall DAO (Agent Runtime 持久化)
// ==========================================
function createMessageDAO(db: DbHandle): MessageDAO {
  return {
    insertUser(sessionId: string, content: string, attachments?: ChatAttachment[]): void {
      db.run(
        `INSERT INTO messages (id, session_id, role, content, attachments, created_at) VALUES (?, ?, 'user', ?, ?, ?)`,
        [randomUUID(), sessionId, content, attachments?.length ? toJson(attachments) : null, Math.floor(Date.now() / 1000)]
      )
    },

    insertAssistant(sessionId: string, content: string, tokenUsage: unknown, thinking?: string, runId?: string | null, model?: string | null): void {
      db.run(
        `INSERT INTO messages (id, session_id, role, content, thinking, token_usage, run_id, model, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), sessionId, content, thinking ?? null, toJson(tokenUsage), runId ?? null, model ?? null, Math.floor(Date.now() / 1000)]
      )
    },

    insertTool(sessionId: string, toolName: string, callId: string, result: unknown, success: boolean, durationMs: number | null, args?: unknown, runId?: string | null): void {
      // content 存完整工具调用元数据 JSON（args/result/success/durationMs），历史加载时一个 parse 还原
      const contentJson = JSON.stringify({ args: args ?? {}, result, success, durationMs })
      db.run(
        `INSERT INTO messages (id, session_id, role, content, tool_name, tool_call_id, run_id, created_at) VALUES (?, ?, 'tool', ?, ?, ?, ?, ?)`,
        [randomUUID(), sessionId, contentJson, toolName, callId, runId ?? null, Math.floor(Date.now() / 1000)]
      )
    },

    listBySession(sessionId: string): Message[] {
      // attachments / token_usage 列为 JSON 文本，读取时反序列化为对象
      const rows = db.query<Omit<Message, "attachments" | "token_usage"> & { attachments: string | null; token_usage: string | null }>(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId]
      )
      return rows.map((r) => ({
        ...r,
        attachments: parseJson<ChatAttachment[]>(r.attachments),
        token_usage: parseJson<Message["token_usage"]>(r.token_usage),
      }))
    },
  }
}

function createToolCallDAO(db: DbHandle): ToolCallDAO {
  return {
    insert(id: string, sessionId: string, toolName: string, args: unknown, runId?: string | null): void {
      db.run(
        `INSERT INTO tool_calls (id, session_id, tool_name, args, success, run_id, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [id, sessionId, toolName, toJson(args), runId ?? null, Math.floor(Date.now() / 1000)]
      )
    },

    updateResult(id: string, result: unknown, success: boolean, durationMs: number): void {
      db.run(
        `UPDATE tool_calls SET result = ?, success = ?, duration_ms = ? WHERE id = ?`,
        [toJson(result), success ? 1 : 0, durationMs, id]
      )
    },
  }
}

function createAgentRunDAO(db: DbHandle): AgentRunDAO {
  return {
    create(id: string, sessionId: string, startedAt: number): void {
      db.run(
        `INSERT INTO agent_runs (id, session_id, started_at, status) VALUES (?, ?, ?, 'running')`,
        [id, sessionId, startedAt]
      )
    },

    finish(id: string, status: AgentRun["status"], finishedAt: number, durationMs: number, toolCallCount: number): void {
      db.run(
        `UPDATE agent_runs SET finished_at = ?, duration_ms = ?, tool_call_count = ?, status = ? WHERE id = ?`,
        [finishedAt, durationMs, toolCallCount, status, id]
      )
    },

    listBySession(sessionId: string): AgentRun[] {
      return db.query<AgentRun>(
        `SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at ASC`,
        [sessionId]
      )
    },
  }
}

// ==========================================
// Knowledge / Memory DAO (M4: 知识库 + 记忆)
// ==========================================
function rowToKnowledge(row: Record<string, unknown>): KnowledgeItem {
  return {
    id: row.id as string,
    type: row.type as KnowledgeItem["type"],
    title: row.title as string,
    summary: row.summary as string,
    keywords: parseJson<string[]>(row.keywords as string) ?? [],
    tags: parseJson<string[]>(row.tags as string),
    source_url: (row.source_url as string) ?? null,
    file_path: row.file_path as string,
    workspace_id: (row.workspace_id as string) ?? null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    embedding_hash: (row.embedding_hash as string) ?? null,
  }
}

function createKnowledgeDAO(db: DbHandle): KnowledgeDAO {
  return {
    create(input) {
      const now = Math.floor(Date.now() / 1000)
      db.run(
        `INSERT INTO knowledge_items
           (id, type, title, summary, keywords, tags, source_url, file_path, workspace_id, created_at, updated_at, embedding_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.type,
          input.title,
          input.summary,
          toJson(input.keywords),
          input.tags ? toJson(input.tags) : null,
          input.source_url,
          input.file_path,
          input.workspace_id,
          now,
          now,
          input.embedding_hash ?? null,
        ]
      )
      const row = db.queryOne<Record<string, unknown>>("SELECT * FROM knowledge_items WHERE id = ?", [input.id])
      return rowToKnowledge(row!)
    },

    get(id) {
      const row = db.queryOne<Record<string, unknown>>("SELECT * FROM knowledge_items WHERE id = ?", [id])
      return row ? rowToKnowledge(row) : undefined
    },

    list(opts) {
      const where: string[] = []
      const params: unknown[] = []
      if (opts?.type) {
        where.push("type = ?")
        params.push(opts.type)
      }
      const sql = `SELECT * FROM knowledge_items
        ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY created_at DESC
        ${opts?.limit ? `LIMIT ${opts.limit}` : ""}`
      return db.query<Record<string, unknown>>(sql, params).map(rowToKnowledge)
    },

    coarseSearch({ query, type, limit = 30 }) {
      // 分词：空白/标点切分 → CJK 段做 bigram，英文段原样；命中任一词即候选，交给 LLM 重排
      const segments = query.split(/[\s,，。、;；:：!?！？]+/).map((t) => t.trim()).filter(Boolean)
      const tokens = new Set<string>()
      for (const seg of segments) {
        const hasCjk = /[\u4e00-\u9fff]/.test(seg)
        if (hasCjk && seg.length >= 2) {
          // bigram 滑窗
          for (let i = 0; i < seg.length - 1; i++) tokens.add(seg.slice(i, i + 2))
          tokens.add(seg)
        } else {
          tokens.add(seg)
        }
      }
      const where: string[] = []
      const params: unknown[] = []
      if (tokens.size > 0) {
        const tokenClauses: string[] = []
        for (const tok of tokens) {
          const like = `%${tok}%`
          tokenClauses.push("(title LIKE ? OR summary LIKE ? OR tags LIKE ? OR keywords LIKE ?)")
          params.push(like, like, like, like)
        }
        where.push(`(${tokenClauses.join(" OR ")})`)
      }
      if (type) {
        where.push("type = ?")
        params.push(type)
      }
      if (where.length === 0) {
        where.push("1=1")
      }
      const sql = `SELECT * FROM knowledge_items
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ${limit}`
      return db.query<Record<string, unknown>>(sql, params).map(rowToKnowledge)
    },

    findBySourceUrl(url) {
      const row = db.queryOne<Record<string, unknown>>(
        "SELECT * FROM knowledge_items WHERE source_url = ?",
        [url]
      )
      return row ? rowToKnowledge(row) : undefined
    },

    findByTitle(title) {
      const row = db.queryOne<Record<string, unknown>>(
        "SELECT * FROM knowledge_items WHERE title = ?",
        [title]
      )
      return row ? rowToKnowledge(row) : undefined
    },

    delete(id) {
      db.run("DELETE FROM knowledge_items WHERE id = ?", [id])
    },
  }
}

function createMemoryDAO(db: DbHandle): MemoryDAO {
  const rowToMemory = (row: Record<string, unknown>): MemoryItem => ({
    id: row.id as string,
    layer: row.layer as MemoryItem["layer"],
    category: row.category as string,
    content: row.content as string,
    confidence: row.confidence as number,
    source_session: (row.source_session as string) ?? null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  })

  return {
    upsert(input) {
      const now = Math.floor(Date.now() / 1000)
      const existing = db.queryOne<Record<string, unknown>>(
        "SELECT * FROM memory_items WHERE layer = ? AND category = ?",
        [input.layer, input.category]
      )
      if (existing) {
        db.run(
          `UPDATE memory_items SET content = ?, confidence = ?, updated_at = ?
           ${input.source_session !== undefined ? ", source_session = ?" : ""}
           WHERE id = ?`,
          input.source_session !== undefined
            ? [input.content, input.confidence, now, input.source_session, existing.id]
            : [input.content, input.confidence, now, existing.id]
        )
        return rowToMemory(db.queryOne<Record<string, unknown>>("SELECT * FROM memory_items WHERE id = ?", [existing.id])!)
      }
      const id = input.id ?? randomUUID()
      db.run(
        `INSERT INTO memory_items (id, layer, category, content, confidence, source_session, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.layer, input.category, input.content, input.confidence, input.source_session ?? null, now, now]
      )
      return rowToMemory(db.queryOne<Record<string, unknown>>("SELECT * FROM memory_items WHERE id = ?", [id])!)
    },

    get(id) {
      const row = db.queryOne<Record<string, unknown>>("SELECT * FROM memory_items WHERE id = ?", [id])
      return row ? rowToMemory(row) : undefined
    },

    list(filter) {
      const where: string[] = []
      const params: unknown[] = []
      if (filter?.layer) {
        where.push("layer = ?")
        params.push(filter.layer)
      }
      if (filter?.minConfidence !== undefined) {
        where.push("confidence >= ?")
        params.push(filter.minConfidence)
      }
      const sql = `SELECT * FROM memory_items
        ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY layer ASC, confidence DESC, updated_at DESC`
      return db.query<Record<string, unknown>>(sql, params).map(rowToMemory)
    },

    update(id, patch) {
      const sets: string[] = []
      const params: unknown[] = []
      if (patch.content !== undefined) { sets.push("content = ?"); params.push(patch.content) }
      if (patch.confidence !== undefined) { sets.push("confidence = ?"); params.push(patch.confidence) }
      if (patch.category !== undefined) { sets.push("category = ?"); params.push(patch.category) }
      if (patch.layer !== undefined) { sets.push("layer = ?"); params.push(patch.layer) }
      if (sets.length === 0) return this.get(id)
      sets.push("updated_at = ?")
      params.push(Math.floor(Date.now() / 1000))
      params.push(id)
      db.run(`UPDATE memory_items SET ${sets.join(", ")} WHERE id = ?`, params)
      return this.get(id)
    },

    delete(id) {
      db.run("DELETE FROM memory_items WHERE id = ?", [id])
    },
  }
}

// ==========================================
// ScheduledJob / JobRun DAO (M5: 定时任务)
// ==========================================
function rowToScheduledJob(row: Record<string, unknown>): ScheduledJob {
  return {
    id: row.id as string,
    description: row.description as string,
    cron_expr: row.cron_expr as string,
    handler_type: row.handler_type as string,
    handler_config: parseJson<Record<string, unknown>>(row.handler_config as string) ?? {},
    enabled: row.enabled as 0 | 1,
    last_run_at: (row.last_run_at as number) ?? null,
    next_run_at: (row.next_run_at as number) ?? null,
    last_result: (row.last_result as string) ?? null,
    created_at: row.created_at as number,
    created_by_session: (row.created_by_session as string) ?? null,
  }
}

function rowToJobRun(row: Record<string, unknown>): JobRun {
  return {
    id: row.id as string,
    job_id: row.job_id as string,
    started_at: row.started_at as number,
    finished_at: (row.finished_at as number) ?? null,
    success: row.success as 0 | 1,
    output: (row.output as string) ?? null,
    artifacts: parseJson<string[]>(row.artifacts as string),
    session_id: (row.session_id as string) ?? null,
  }
}

function createScheduledJobDAO(db: DbHandle): ScheduledJobDAO {
  return {
    create(input) {
      const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const now = Math.floor(Date.now() / 1000)
      db.run(
        `INSERT INTO scheduled_jobs
           (id, description, cron_expr, handler_type, handler_config, enabled, last_run_at, next_run_at, last_result, created_at, created_by_session)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
        [
          id,
          input.description,
          input.cron_expr,
          input.handler_type,
          toJson(input.handler_config),
          input.enabled ?? 1,
          input.next_run_at ?? null,
          now,
          input.created_by_session ?? null,
        ]
      )
      return rowToScheduledJob(db.queryOne<Record<string, unknown>>("SELECT * FROM scheduled_jobs WHERE id = ?", [id])!)
    },

    get(id) {
      const row = db.queryOne<Record<string, unknown>>("SELECT * FROM scheduled_jobs WHERE id = ?", [id])
      return row ? rowToScheduledJob(row) : undefined
    },

    listAll() {
      return db
        .query<Record<string, unknown>>("SELECT * FROM scheduled_jobs ORDER BY created_at DESC")
        .map(rowToScheduledJob)
    },

    listEnabled() {
      return db
        .query<Record<string, unknown>>("SELECT * FROM scheduled_jobs WHERE enabled = 1 ORDER BY next_run_at ASC")
        .map(rowToScheduledJob)
    },

    setEnabled(id, enabled, nextRunAt) {
      db.run("UPDATE scheduled_jobs SET enabled = ?, next_run_at = ? WHERE id = ?", [enabled, nextRunAt, id])
    },

    recordRun(id, lastRunAt, lastResult, nextRunAt) {
      db.run(
        "UPDATE scheduled_jobs SET last_run_at = ?, last_result = ?, next_run_at = ? WHERE id = ?",
        [lastRunAt, lastResult, nextRunAt, id]
      )
    },

    updateHandlerConfig(id, config) {
      db.run("UPDATE scheduled_jobs SET handler_config = ? WHERE id = ?", [toJson(config), id])
    },

    delete(id) {
      db.run("DELETE FROM job_runs WHERE job_id = ?", [id])
      db.run("DELETE FROM scheduled_jobs WHERE id = ?", [id])
    },
  }
}

function createJobRunDAO(db: DbHandle): JobRunDAO {
  return {
    start(jobId) {
      const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const now = Math.floor(Date.now() / 1000)
      db.run(
        "INSERT INTO job_runs (id, job_id, started_at, finished_at, success, output, artifacts) VALUES (?, ?, ?, NULL, 0, NULL, NULL)",
        [id, jobId, now]
      )
      return id
    },

    complete(id, success, output, artifacts, sessionId) {
      const now = Math.floor(Date.now() / 1000)
      db.run(
        "UPDATE job_runs SET finished_at = ?, success = ?, output = ?, artifacts = ?, session_id = ? WHERE id = ?",
        [now, success ? 1 : 0, output, artifacts ? toJson(artifacts) : null, sessionId ?? null, id]
      )
    },

    listByJob(jobId, limit = 5) {
      return db
        .query<Record<string, unknown>>(
          "SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?",
          [jobId, limit]
        )
        .map(rowToJobRun)
    },

    /** 全部分页拉取（按 started_at 倒序）；limit/offset 由调用方保证为数字 */
    listAll(limit = 30, offset = 0) {
      return db
        .query<Record<string, unknown>>(
          "SELECT * FROM job_runs ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?",
          [limit, offset]
        )
        .map(rowToJobRun)
    },

    countByJob(jobId) {
      const row = db.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM job_runs WHERE job_id = ?", [jobId])
      return row?.c ?? 0
    },

    countToday() {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      const midnight = Math.floor(d.getTime() / 1000)
      const row = db.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM job_runs WHERE started_at >= ?", [midnight])
      return row?.c ?? 0
    },

    countAll() {
      const row = db.queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM job_runs")
      return row?.c ?? 0
    },
  }
}

// ==========================================
// 数据库初始化 + 单例（异步）
// ==========================================
let instance: IDatabase | null = null
let initPromise: Promise<IDatabase> | null = null

/** 初始化数据库（首次调用会触发 sql.js 加载 + schema 执行） */
export async function initDatabase(): Promise<IDatabase> {
  if (instance) return instance
  if (initPromise) return initPromise

  initPromise = (async () => {
    const SQL = await getSQL()
    const dbPath = getDatabasePath()
    const dbDir = dirname(dbPath)

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    const handle = DbHandle.open(SQL, dbPath)
    handle.exec(SCHEMA_SQL)
    // 轻量迁移: 旧库补 archived 列（已存在则忽略）
    try {
      handle.exec("ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
    } catch {
      /* 列已存在 */
    }
    // 轻量迁移: 旧库补 job_runs.session_id 列（运行记录关联会话，已存在则忽略）
    try {
      handle.exec("ALTER TABLE job_runs ADD COLUMN session_id TEXT")
    } catch {
      /* 列已存在 */
    }
    // 轻量迁移: 旧库补 messages.thinking 列（assistant 思考过程持久化，已存在则忽略）
    try {
      handle.exec("ALTER TABLE messages ADD COLUMN thinking TEXT")
    } catch {
      /* 列已存在 */
    }
    // 轻量迁移: 任务轨迹（agent run）—— messages/tool_calls 补 run_id 列（已存在则忽略）
    try {
      handle.exec("ALTER TABLE messages ADD COLUMN run_id TEXT")
    } catch {
      /* 列已存在 */
    }
    try {
      handle.exec("ALTER TABLE tool_calls ADD COLUMN run_id TEXT")
    } catch {
      /* 列已存在 */
    }
    // 轻量迁移: 旧库补 messages.attachments 列（用户消息图片附件 JSON，已存在则忽略）
    try {
      handle.exec("ALTER TABLE messages ADD COLUMN attachments TEXT")
    } catch {
      /* 列已存在 */
    }
    // 轻量迁移: 旧库补 messages.model 列（assistant 实际使用的模型，历史上消息重进会话后仍可展示）
    try {
      handle.exec("ALTER TABLE messages ADD COLUMN model TEXT")
    } catch {
      /* 列已存在 */
    }
    // 启动时收敛上次崩溃残留的 running run（避免历史消息永久显示「任务执行中」）
    handle.exec("UPDATE agent_runs SET status = 'paused' WHERE status = 'running'")
    handle.commit()

    instance = {
      session: createSessionDAO(handle),
      message: createMessageDAO(handle),
      toolCall: createToolCallDAO(handle),
      agentRun: createAgentRunDAO(handle),
      note: createNoteDAO(handle),
      noteCategory: createNoteCategoryDAO(handle),
      knowledge: createKnowledgeDAO(handle),
      memory: createMemoryDAO(handle),
      scheduledJob: createScheduledJobDAO(handle),
      jobRun: createJobRunDAO(handle),
      close: () => handle.close(),
    }
    return instance
  })()

  return initPromise
}

/** 同步获取数据库（需先 await initDatabase()） */
export function getDatabase(): IDatabase {
  if (!instance) {
    throw new Error("Database not initialized. Call initDatabase() first.")
  }
  return instance
}
