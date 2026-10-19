/**
 * 自进化记忆引擎 (M4)
 *
 * 三层记忆:
 *   - profile:     静态画像（职业、关注方向等，长期稳定）
 *   - state:       动态状态（当前项目、近期目标等，会过期）
 *   - preference:  偏好规则（输出格式、交互习惯等）
 *
 * 触发时机:
 *   1. 每 5 轮对话自动提取（tick）
 *   2. 用户显式「记住 xxx」（handleExplicitRemember）
 *   3. 知识库入库时（onKnowledgeItemCreated）
 *
 * 持久化: 同 layer + category 硬删除覆盖（由 MemoryDAO.upsert 实现）
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { Database, MemoryItem } from "../db/types"
import type { KnowledgeItem } from "../db/types"
import { llmJson } from "./llm-helper"

type Layer = MemoryItem["layer"]

interface ExtractedMemory {
  layer: Layer
  category: string
  content: string
  confidence: number
}

interface ExtractionResult {
  shouldUpdate: boolean
  newMemories: ExtractedMemory[]
}

const VALID_LAYERS: Layer[] = ["profile", "state", "preference"]

/** LLM 提取提示词 */
const EXTRACT_SYSTEM = `你是用户记忆提取助手。从对话中提取关于用户的稳定信息，存入三层记忆：
- profile: 用户的静态画像（职业、身份、长期关注方向、技能背景）
- state: 用户的动态状态（当前在做的项目、近期目标、正在处理的任务）
- preference: 用户的偏好规则（喜欢的输出格式、沟通风格、工具偏好、禁忌）

规则：
1. 只提取明确、稳定、有复用价值的信息。不要提取临时问答内容。
2. category 用简短的中文名（如"职业"、"输出风格"、"当前项目"）。
3. confidence 0.0-1.0，信息越明确越高。
4. 同 category 的新旧信息用新内容覆盖（硬删除语义）。
5. 若没有值得记忆的信息，返回 shouldUpdate: false。

只输出 JSON: {"shouldUpdate": boolean, "newMemories": [{"layer": "profile|state|preference", "category": "分类名", "content": "具体内容", "confidence": 0.0-1.0}]}`

export class MemoryEngine {
  /** 每会话轮次计数器（sessionId -> count） */
  private roundCounters = new Map<string, number>()

  constructor(private db: Database) {}

  /** 每轮对话结束后调用；每 5 轮触发一次提取 */
  async tick(sessionId: string, messages: AgentMessage[]): Promise<void> {
    const count = (this.roundCounters.get(sessionId) ?? 0) + 1
    this.roundCounters.set(sessionId, count)
    if (count % 5 !== 0) return

    const { userText, assistantText } = this.extractLastExchange(messages)
    if (!userText && !assistantText) return

    await this.extractAndUpsert(userText, assistantText, sessionId)
  }

  /** 用户显式「记住 xxx」 */
  async handleExplicitRemember(text: string, sessionId: string): Promise<number> {
    return this.extractAndUpsert(text, "", sessionId, true)
  }

  /** 知识库入库时触发 */
  async onKnowledgeItemCreated(item: KnowledgeItem): Promise<void> {
    const text = `新入库知识条目: ${item.title}\n摘要: ${item.summary}\n关键词: ${item.keywords.join(", ")}`
    await this.extractAndUpsert(text, "", null)
  }

  /** 构建 system prompt 中的记忆注入块（按会话模式筛选） */
  buildMemoryBlock(mode: "free" | "project"): string {
    const all = this.db.memory.list({ minConfidence: 0.6 })
    if (all.length === 0) return ""

    const profile = all.filter((m) => m.layer === "profile")
    const state = all.filter((m) => m.layer === "state")
    const preferences = all.filter((m) => m.layer === "preference")

    const block: string[] = ["## 关于用户的记忆（来自长期记忆，仅供参考，不要主动提及）"]

    if (profile.length > 0) {
      block.push("", "### 静态画像")
      for (const m of profile) block.push(`- ${m.category}: ${m.content}`)
    }

    // project 模式多注入 state；free 模式多注入 preference
    if (mode === "project" && state.length > 0) {
      block.push("", "### 动态状态")
      for (const m of state) block.push(`- ${m.category}: ${m.content}`)
    }

    if (preferences.length > 0) {
      block.push("", "### 偏好规则")
      for (const m of preferences) block.push(`- ${m.category}: ${m.content}`)
    }

    // free 模式也补充 state（若有）
    if (mode === "free" && state.length > 0) {
      block.push("", "### 动态状态（供参考）")
      for (const m of state) block.push(`- ${m.category}: ${m.content}`)
    }

    return block.join("\n")
  }

  // ==========================================
  // 内部
  // ==========================================

  private extractLastExchange(messages: AgentMessage[]): { userText: string; assistantText: string } {
    let userText = ""
    let assistantText = ""
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!assistantText && m.role === "assistant") {
        assistantText = this.messageToText(m)
      } else if (!userText && m.role === "user") {
        userText = this.messageToText(m)
        break
      }
    }
    return { userText, assistantText }
  }

  private messageToText(m: AgentMessage): string {
    const content = (m as { content?: unknown }).content
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
      return content
        .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
    }
    return ""
  }

  private async extractAndUpsert(userText: string, assistantText: string, sessionId: string | null, explicit = false): Promise<number> {
    const user = `用户: ${userText}\n\n助手: ${assistantText}\n\n${explicit ? "（用户明确要求记住上述内容）" : ""}`
    let result: ExtractionResult
    try {
      result = await llmJson<ExtractionResult>(EXTRACT_SYSTEM, user, { temperature: 0.2, maxTokens: 800 })
    } catch {
      return 0
    }
    if (!result?.shouldUpdate || !Array.isArray(result.newMemories)) return 0

    let upserted = 0
    for (const mem of result.newMemories) {
      if (!mem || !mem.content || !mem.category) continue
      if (!VALID_LAYERS.includes(mem.layer)) continue
      const confidence = typeof mem.confidence === "number" ? Math.min(1, Math.max(0, mem.confidence)) : 0.7
      this.db.memory.upsert({
        layer: mem.layer,
        category: mem.category.slice(0, 40),
        content: mem.content.slice(0, 500),
        confidence,
        source_session: sessionId,
      })
      upserted++
    }
    return upserted
  }
}
