/**
 * 知识库入库服务 (M4)
 * 入库流水线: 内容 → 文件落盘 → 去重 → LLM 生成元数据 → 写 SQLite → 触发记忆
 *
 * 支持 4 种类型: note / article / image / doc
 */
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Database, KnowledgeItem } from "../db/types"
import { llmJson } from "../agent/llm-helper"

export interface IngestNoteInput {
  title?: string
  content: string
  workspaceId?: string | null
}

export interface IngestArticleInput {
  url: string
  html?: string
  /** 插件端已本地提取的正文纯文本（优先于 html） */
  text?: string
  title?: string
  workspaceId?: string | null
}

export interface IngestImageInput {
  filePath: string          // 原始图片绝对路径（已保存到 library/images/ 或外部）
  title?: string
  description?: string
  workspaceId?: string | null
}

export interface IngestDocInput {
  title?: string
  content: string
  workspaceId?: string | null
}

interface LlmMeta {
  title: string
  summary: string
  keywords: string[]
  tags: string[]
}

function getLibraryDir(): string {
  return join(homedir(), ".nexa", "library")
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** 极简 HTML → 纯文本剥离（v1 不引入 readability，够用即可） */
function stripHtml(html: string): string {
  let text = html
    // 去 script/style
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // 块级标签后加换行
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article|header|footer)>/gi, "\n")
    // 去其余标签
    .replace(/<[^>]+>/g, "")
  // 解码常见实体
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  // 压缩空行
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

/** 调用 LLM 生成标题/摘要/关键词/标签 */
async function generateMeta(content: string, hintTitle?: string): Promise<LlmMeta> {
  const truncated = content.length > 4000 ? content.slice(0, 4000) + "\n…（内容已截断）" : content
  const sys = `你是知识库元数据生成助手。根据给定内容，输出 JSON：
{
  "title": "不超过 30 字的标题",
  "summary": "一句话摘要，不超过 80 字",
  "keywords": ["3-8 个关键词，短词"],
  "tags": ["2-5 个分类标签"]
}
只输出 JSON，不要解释。`
  const user = hintTitle ? `参考标题: ${hintTitle}\n\n内容:\n${truncated}` : `内容:\n${truncated}`
  const meta = await llmJson<LlmMeta>(sys, user, { temperature: 0.3, maxTokens: 600 })
  // 防御性兜底
  return {
    title: (meta.title || hintTitle || "未命名").slice(0, 80),
    summary: (meta.summary || "").slice(0, 200) || "（无摘要）",
    keywords: Array.isArray(meta.keywords) ? meta.keywords.slice(0, 10) : [],
    tags: Array.isArray(meta.tags) ? meta.tags.slice(0, 8) : [],
  }
}

/**
 * LLM 元数据生成失败兜底：入库不应因 LLM 异常而丢失内容。
 * 启发式生成：标题取 hintTitle 或正文首行截断，摘要取正文开头。
 */
async function generateMetaSafe(content: string, hintTitle?: string): Promise<LlmMeta> {
  try {
    return await generateMeta(content, hintTitle)
  } catch (err) {
    console.warn("[knowledge] generateMeta 失败，使用启发式兜底:", err instanceof Error ? err.message : err)
    const text = content.replace(/\s+/g, " ").trim()
    return {
      title: (hintTitle || text.slice(0, 30) || "未命名").slice(0, 80),
      summary: text.slice(0, 80) || "（无摘要）",
      keywords: [],
      tags: [],
    }
  }
}

export class KnowledgeBaseService {
  constructor(private db: Database) {}

  /** 笔记入库：纯文本/markdown */
  async ingestNote(input: IngestNoteInput): Promise<KnowledgeItem> {
    const id = `kb-${randomUUID()}`
    const dir = join(getLibraryDir(), "notes")
    ensureDir(dir)
    const filePath = join(dir, `${id}.md`)
    const title = input.title || "未命名笔记"
    const body = `# ${title}\n\n${input.content}`
    writeFileSync(filePath, body, "utf-8")

    const meta = await generateMetaSafe(input.content, input.title)
    return this.persist({
      id,
      type: "note",
      title: meta.title,
      summary: meta.summary,
      keywords: meta.keywords,
      tags: meta.tags,
      source_url: null,
      file_path: filePath,
      workspace_id: input.workspaceId ?? null,
    })
  }

  /** 文章入库：URL → 抓取 HTML → 纯文本 → 元数据 */
  async ingestArticle(input: IngestArticleInput): Promise<KnowledgeItem | null> {
    // 去重：同 URL 已存在则跳过
    if (this.db.knowledge.findBySourceUrl(input.url)) return null

    // 插件端已本地提取正文文本时直接使用（避免传大 HTML 撑爆中继消息上限）
    let text = input.text?.trim() ?? ""
    if (!text) {
      let html = input.html
      if (!html) {
        try {
          const resp = await fetch(input.url, { headers: { "User-Agent": "Mozilla/5.0 Nexa/1.0" } })
          html = await resp.text()
        } catch {
          throw new Error(`无法抓取 URL: ${input.url}`)
        }
      }
      text = stripHtml(html)
    }
    if (!text) throw new Error("文章正文提取为空")

    const id = `kb-${randomUUID()}`
    const dir = join(getLibraryDir(), "articles")
    ensureDir(dir)
    const filePath = join(dir, `${id}.md`)
    writeFileSync(filePath, `# ${input.title || text.slice(0, 60)}\n\n> 来源: ${input.url}\n\n${text}`, "utf-8")

    const meta = await generateMetaSafe(text, input.title)
    return this.persist({
      id,
      type: "article",
      title: meta.title,
      summary: meta.summary,
      keywords: meta.keywords,
      tags: meta.tags,
      source_url: input.url,
      file_path: filePath,
      workspace_id: input.workspaceId ?? null,
    })
  }

  /** 图片入库：图片路径 + 描述（v1 不做 vision，描述由用户/Agent 提供） */
  async ingestImage(input: IngestImageInput): Promise<KnowledgeItem> {
    const id = `kb-${randomUUID()}`
    const dir = join(getLibraryDir(), "images")
    ensureDir(dir)
    // 描述存为同名 .txt，便于检索
    const descPath = join(dir, `${id}.txt`)
    const desc = input.description || input.title || "（无描述）"
    writeFileSync(descPath, desc, "utf-8")

    const meta = await generateMetaSafe(desc, input.title)
    return this.persist({
      id,
      type: "image",
      title: meta.title,
      summary: meta.summary,
      keywords: meta.keywords,
      tags: meta.tags,
      source_url: null,
      file_path: input.filePath,
      workspace_id: input.workspaceId ?? null,
    })
  }

  /** 文档入库：上传的 markdown/纯文本 */
  async ingestDoc(input: IngestDocInput): Promise<KnowledgeItem> {
    const id = `kb-${randomUUID()}`
    const dir = join(getLibraryDir(), "docs")
    ensureDir(dir)
    const filePath = join(dir, `${id}.md`)
    const title = input.title || "未命名文档"
    writeFileSync(filePath, `# ${title}\n\n${input.content}`, "utf-8")

    const meta = await generateMetaSafe(input.content, input.title)
    return this.persist({
      id,
      type: "doc",
      title: meta.title,
      summary: meta.summary,
      keywords: meta.keywords,
      tags: meta.tags,
      source_url: null,
      file_path: filePath,
      workspace_id: input.workspaceId ?? null,
    })
  }

  /**
   * 知识库召回：SQLite 粗筛 → LLM 重排 → topN
   * 失败降级：LLM 重排异常时退化为粗筛结果（按 created_at）。
   */
  async search(params: { query: string; type?: KnowledgeItem["type"]; topN?: number; includeContent?: boolean }): Promise<KnowledgeItem[]> {
    const { query, type, topN = 5, includeContent = true } = params
    const candidates = this.db.knowledge.coarseSearch({ query, type, limit: 30 })
    if (candidates.length === 0) return []

    // 只有 1 条候选无需重排
    let ranked = candidates
    if (candidates.length > 1) {
      try {
        const candidateList = candidates
          .map((c, i) => `${i + 1}. [id:${c.id}] 标题: ${c.title} | 摘要: ${c.summary} | 关键词: ${c.keywords.join(", ")}`)
          .join("\n")
        const sys = `你是知识库重排助手。根据用户查询，对以下候选条目按相关度从高到低排序。
只输出 JSON 数组，格式: [{"id": "条目id", "score": 0.0-1.0}]，包含所有候选条目，按 score 降序。不要解释。`
        const user = `查询: ${query}\n\n候选条目:\n${candidateList}`
        const result = await llmJson<Array<{ id: string; score: number }>>(sys, user, { temperature: 0.1, maxTokens: 1024 })
        const scoreMap = new Map<string, number>()
        for (const r of result) {
          if (r && typeof r.id === "string" && typeof r.score === "number") {
            scoreMap.set(r.id, r.score)
          }
        }
        ranked = [...candidates].sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
      } catch {
        // 降级：保留粗筛顺序
        ranked = candidates
      }
    }

    const top = ranked.slice(0, topN)
    if (includeContent) {
      for (const item of top) {
        ;(item as KnowledgeItem & { content?: string }).content = this.readContent(item)
      }
    }
    return top
  }

  /** 读文件内容（供召回时按需加载） */
  readContent(item: KnowledgeItem): string {
    try {
      return readFileSync(item.file_path, "utf-8")
    } catch {
      return ""
    }
  }

  private persist(item: Omit<KnowledgeItem, "created_at" | "updated_at" | "embedding_hash">): KnowledgeItem {
    return this.db.knowledge.create({ ...item, embedding_hash: null })
  }
}
