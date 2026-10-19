/**
 * 记忆 Agent 工具 (M4): memory_read / memory_write
 * Agent 可主动读取用户记忆，或显式写入一条记忆。
 */
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { MemoryEngine } from "./memory-engine"
import type { Database, MemoryItem } from "../db/types"

const memoryReadParams = Type.Object({
  layer: Type.Optional(Type.String({ description: "按层筛选: profile / state / preference，省略返回全部" })),
})

export function createMemoryReadTool(db: Database): AgentTool<typeof memoryReadParams> {
  return {
    name: "memory_read",
    label: "读取记忆",
    description: "读取关于用户的长期记忆（画像/状态/偏好），用于个性化回复。返回各层记忆条目。",
    parameters: memoryReadParams,
    execute: async (_id, params) => {
      const filter = params.layer ? { layer: params.layer as MemoryItem["layer"], minConfidence: 0.6 } : { minConfidence: 0.6 }
      const items = db.memory.list(filter)
      if (items.length === 0) {
        return { content: [{ type: "text", text: "暂无记忆条目。" }], details: { count: 0 } }
      }
      const grouped: Record<string, MemoryItem[]> = {}
      for (const m of items) {
        ;(grouped[m.layer] ||= []).push(m)
      }
      const text = Object.entries(grouped)
        .map(([layer, arr]) => {
          const label = layer === "profile" ? "静态画像" : layer === "state" ? "动态状态" : "偏好规则"
          const lines = arr.map((m) => `- ${m.category}: ${m.content}`).join("\n")
          return `【${label}】\n${lines}`
        })
        .join("\n\n")
      return { content: [{ type: "text", text }], details: { count: items.length } }
    },
  }
}

const memoryWriteParams = Type.Object({
  layer: Type.String({ description: "记忆层: profile / state / preference" }),
  category: Type.String({ description: "分类名（如'输出风格'、'当前项目'），同层同分类会覆盖旧内容" }),
  content: Type.String({ description: "记忆内容" }),
  confidence: Type.Optional(Type.Number({ description: "置信度 0.0-1.0，默认 0.8" })),
})

export function createMemoryWriteTool(memory: MemoryEngine, db: Database, sessionId: string): AgentTool<typeof memoryWriteParams> {
  return {
    name: "memory_write",
    label: "写入记忆",
    description: "把一条关于用户的信息写入长期记忆。同层同分类会覆盖旧内容。仅在信息明确且有复用价值时使用。",
    parameters: memoryWriteParams,
    execute: async (_id, params) => {
      const layer = params.layer as MemoryItem["layer"]
      if (!["profile", "state", "preference"].includes(layer)) {
        throw new Error(`layer 必须是 profile / state / preference 之一，收到: ${params.layer}`)
      }
      if (!params.category?.trim() || !params.content?.trim()) {
        throw new Error("category 和 content 不能为空")
      }
      // 显式写入也走 LLM 提取保持一致性（短文本，成本低）
      const upserted = await memory.handleExplicitRemember(
        `请记住：layer=${layer}, category=${params.category}, content=${params.content}`,
        sessionId,
      )
      // 兜底：若 LLM 提取未产出，直接写入
      if (upserted === 0) {
        db.memory.upsert({
          layer,
          category: params.category.trim().slice(0, 40),
          content: params.content.trim().slice(0, 500),
          confidence: params.confidence ?? 0.8,
          source_session: sessionId,
        })
      }
      return {
        content: [{ type: "text", text: `已记住 [${layer}/${params.category}]: ${params.content}` }],
        details: { layer, category: params.category },
      }
    },
  }
}

export function createMemoryTools(memory: MemoryEngine, db: Database, sessionId: string): AgentTool[] {
  return [createMemoryReadTool(db), createMemoryWriteTool(memory, db, sessionId)]
}
