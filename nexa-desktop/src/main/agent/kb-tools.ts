/**
 * 知识库 Agent 工具 (M4): kb_search / kb_add_note / kb_add_article / kb_add_image
 * Agent 通过这些工具检索本地知识库、把对话笔记/文章/图片入库。
 */
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { KnowledgeBaseService } from "../knowledge/service"
import type { KnowledgeItem } from "../db/types"

const kbSearchParams = Type.Object({
  query: Type.String({ description: "检索关键词或自然语言问题" }),
  type: Type.Optional(Type.String({ description: "限定类型: note / article / image / doc" })),
  topN: Type.Optional(Type.Number({ description: "返回条数，默认 5" })),
})

export function createKbSearchTool(kb: KnowledgeBaseService): AgentTool<typeof kbSearchParams> {
  return {
    name: "kb_search",
    label: "检索知识库",
    description: "从本地知识库召回相关条目（SQLite 粗筛 + LLM 重排），返回标题、摘要和正文内容。",
    parameters: kbSearchParams,
    execute: async (_id, params) => {
      const results = await kb.search({
        query: params.query,
        type: params.type as KnowledgeItem["type"] | undefined,
        topN: params.topN ?? 5,
        includeContent: true,
      })
      if (results.length === 0) {
        return { content: [{ type: "text", text: "知识库中未找到相关条目。" }], details: { count: 0 } }
      }
      const text = results
        .map((r, i) => {
          const content = (r as KnowledgeItem & { content?: string }).content ?? ""
          const body = content.length > 800 ? content.slice(0, 800) + "\n…（已截断）" : content
          return `【${i + 1}】${r.title}\n摘要: ${r.summary}\n类型: ${r.type}${r.source_url ? `\n来源: ${r.source_url}` : ""}\n---\n${body}`
        })
        .join("\n\n")
      return {
        content: [{ type: "text", text }],
        details: { count: results.length, ids: results.map((r) => r.id) },
      }
    },
  }
}

const kbAddNoteParams = Type.Object({
  title: Type.Optional(Type.String({ description: "笔记标题，省略则由 AI 生成" })),
  content: Type.String({ description: "笔记正文（markdown）" }),
})

export function createKbAddNoteTool(kb: KnowledgeBaseService, sessionId: string): AgentTool<typeof kbAddNoteParams> {
  return {
    name: "kb_add_note",
    label: "存入笔记",
    description: "把一段内容作为笔记存入本地知识库，AI 会自动生成摘要、关键词和标签。",
    parameters: kbAddNoteParams,
    execute: async (_id, params) => {
      const item = await kb.ingestNote({ title: params.title, content: params.content, workspaceId: sessionId })
      return {
        content: [{ type: "text", text: `已入库笔记: ${item.title}\n摘要: ${item.summary}\n关键词: ${item.keywords.join(", ")}` }],
        details: { id: item.id },
      }
    },
  }
}

const kbAddArticleParams = Type.Object({
  url: Type.String({ description: "文章 URL" }),
  title: Type.Optional(Type.String({ description: "文章标题，省略则由 AI 生成" })),
})

export function createKbAddArticleTool(kb: KnowledgeBaseService, sessionId: string): AgentTool<typeof kbAddArticleParams> {
  return {
    name: "kb_add_article",
    label: "收藏文章",
    description: "抓取 URL 正文并入库，AI 自动生成摘要、关键词和标签。同 URL 重复会被忽略。",
    parameters: kbAddArticleParams,
    execute: async (_id, params) => {
      const item = await kb.ingestArticle({ url: params.url, title: params.title, workspaceId: sessionId })
      if (!item) {
        return { content: [{ type: "text", text: `该 URL 已存在于知识库，跳过。` }], details: { duplicate: true } }
      }
      return {
        content: [{ type: "text", text: `已入库文章: ${item.title}\n摘要: ${item.summary}\n来源: ${item.source_url}` }],
        details: { id: item.id },
      }
    },
  }
}

const kbAddImageParams = Type.Object({
  filePath: Type.String({ description: "图片文件的绝对路径" }),
  title: Type.Optional(Type.String({ description: "图片标题" })),
  description: Type.Optional(Type.String({ description: "图片描述（v1 无视觉能力，需由你提供）" })),
})

export function createKbAddImageTool(kb: KnowledgeBaseService, sessionId: string): AgentTool<typeof kbAddImageParams> {
  return {
    name: "kb_add_image",
    label: "收藏图片",
    description: "把图片连同描述存入知识库。v1 不支持自动识别图片内容，请提供 description。",
    parameters: kbAddImageParams,
    execute: async (_id, params) => {
      const item = await kb.ingestImage({
        filePath: params.filePath,
        title: params.title,
        description: params.description,
        workspaceId: sessionId,
      })
      return {
        content: [{ type: "text", text: `已入库图片: ${item.title}\n摘要: ${item.summary}` }],
        details: { id: item.id },
      }
    },
  }
}

/** 创建全部知识库工具 */
export function createKnowledgeTools(kb: KnowledgeBaseService, sessionId: string): AgentTool[] {
  return [
    createKbSearchTool(kb),
    createKbAddNoteTool(kb, sessionId),
    createKbAddArticleTool(kb, sessionId),
    createKbAddImageTool(kb, sessionId),
  ]
}
