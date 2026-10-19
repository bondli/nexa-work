/**
 * 轻量 LLM 单次文本完成封装（M4: 知识库元数据生成 / 记忆提取 / 重排）
 * 复用 pi-ai 的 complete + 用户默认模型，不经过 Agent Loop。
 */
import { complete, type Model } from "@earendil-works/pi-ai"
import type { TextContent } from "@earendil-works/pi-ai"
import { getApiKey, loadSettings, resolveModel } from "./settings"

let cachedModel: { model: Model<string>; apiKey: string | undefined } | null = null

/** 取当前默认模型（带缓存，settings 变更后需重启主进程生效） */
function getDefaultModel(): { model: Model<string>; apiKey: string | undefined } {
  if (cachedModel) return cachedModel
  const settings = loadSettings()
  const modelStr = settings.defaultModel || "deepseek/deepseek-v4-flash"
  const model = resolveModel(modelStr)
  if (!model) throw new Error(`无法解析模型: ${modelStr}`)
  cachedModel = { model, apiKey: getApiKey(model.provider) }
  return cachedModel
}

/** 从 AssistantMessage.content 中提取纯文本 */
function extractText(content: unknown[]): string {
  return content
    .filter((c): c is TextContent => (c as TextContent)?.type === "text")
    .map((c) => c.text)
    .join("")
    .trim()
}

/**
 * 让 LLM 按 systemPrompt + userText 生成文本，返回纯字符串
 * 失败时抛错（调用方决定降级策略）
 */
export async function llmText(systemPrompt: string, userText: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
  const { model, apiKey } = getDefaultModel()
  const msg = await complete(
    model,
    {
      systemPrompt,
      messages: [{ role: "user", content: userText, timestamp: Date.now() }],
    },
    {
      apiKey,
      temperature: opts?.temperature ?? 0.3,
      maxTokens: opts?.maxTokens ?? 1024,
    },
  )
  if (msg.stopReason === "error" || msg.stopReason === "aborted") {
    throw new Error(msg.errorMessage || `LLM 调用失败: ${msg.stopReason}`)
  }
  const text = extractText(msg.content as unknown[])
  if (!text) throw new Error("LLM 返回空文本")
  return text
}

/**
 * 让 LLM 输出 JSON。先尝试解析，失败则重试一次（追加"只输出合法 JSON"提示）。
 */
export async function llmJson<T>(systemPrompt: string, userText: string, opts?: { temperature?: number; maxTokens?: number }): Promise<T> {
  const tryParse = (raw: string): T | null => {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    const text = fenced ? fenced[1] : raw
    try {
      return JSON.parse(text) as T
    } catch {
      return null
    }
  }

  const first = await llmText(systemPrompt, userText, opts)
  let parsed = tryParse(first)
  if (parsed) return parsed

  const retry = await llmText(
    systemPrompt + "\n\n重要：你的上一次输出不是合法 JSON。请只输出一个合法 JSON 对象，不要包含任何解释、markdown 代码块标记或额外文字。",
    userText,
    opts,
  )
  parsed = tryParse(retry)
  if (!parsed) throw new Error(`LLM JSON 解析失败: ${retry.slice(0, 200)}`)
  return parsed
}

// ==========================================
// 会话标题清洗（标题生成侧见 runtime.generateTitleAsync）
// ==========================================

/** 纯结构性小标题：单独成行时不携带任务信息，不能作为标题（如 Markdown 的 "## Goal"） */
const STRUCTURAL_TITLE_WORDS = new Set([
  "goal",
  "goals",
  "objective",
  "objectives",
  "context",
  "background",
  "task",
  "tasks",
  "requirement",
  "requirements",
  "overview",
  "summary",
  "description",
  "plan",
  "steps",
  "input",
  "output",
  "目标",
  "背景",
  "上下文",
  "任务",
  "任务描述",
  "需求",
  "要求",
  "概述",
  "总览",
  "摘要",
  "描述",
  "说明",
  "计划",
  "步骤",
  "输入",
  "输出",
  "前言",
  "正文",
])

/** 标题首部需剥离的无信息量字符（引号/括号/Markdown 标记/连接符） */
const LEADING_NOISE = /^[\s"'「『《【(（\[\]*_`~#>|\-–—]+/
/** 标题尾部需剥离的无信息量字符（标点/引号/括号/连接符） */
const TRAILING_NOISE = /[\s"'」』》】)）\]!！?？,，;；:：、。*_`~|\-–—…·]+$/
/** 模型可能加上的标签前缀（"标题："） */
const LEADING_LABEL = /^(?:会话)?(?:标题|title)\s*[:：]\s*/i
/** 截断时优先收尾的边界字符 */
const BREAK_CHARS = /[，。；、,;:：\s]/

/**
 * 清洗标题文本：剥离代码块、行首 Markdown 标记（井号标题、无序/有序列表、引用）、
 * 强调符号与首尾引号标点，换行与连续空格归一为单个空格。返回空串表示不含有效内容。
 */
function cleanTitleText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ") // 代码块
    .replace(/`([^`]*)`/g, "$1") // 行内代码
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接/图片 → 保留可见文字
    .replace(/^[\s>]*(?:#{1,6}|[-*+]|\d+[.、)])\s*/gm, "") // 行首标题/列表/引用标记
    .replace(/[*_~]/g, "") // 强调符号
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_LABEL, "") // "标题：" 之类前缀
    .replace(LEADING_NOISE, "")
    .replace(TRAILING_NOISE, "")
    .trim()
}

/** 标题是否为无信息量的结构性词（"Goal"、"背景"、"需求" 等，忽略标点与大小写） */
function isStructuralOnly(title: string): boolean {
  const key = title.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()
  return key.length > 0 && STRUCTURAL_TITLE_WORDS.has(key)
}

/** 截断到 maxLen 个码点（避免截断 emoji 代理对），并清掉残留尾部标点 */
function truncateTitle(s: string, maxLen: number): string {
  const chars = Array.from(s)
  if (chars.length > maxLen) {
    // 只在末尾 4 个字符内找标点/空格收尾，避免切掉半截词又不至于砍掉半个标题
    let cut = -1
    for (let i = maxLen - 1; i >= Math.max(0, maxLen - 4); i--) {
      if (BREAK_CHARS.test(chars[i])) {
        cut = i
        break
      }
    }
    chars.length = cut > 0 ? cut : maxLen
  }
  return chars.join("").replace(TRAILING_NOISE, "").trim()
}

/**
 * 归一化标题并限长。取第一行有信息量的内容（跳过空行、代码块与 "## Goal"、"背景" 这类
 * 纯结构小标题），剥离 Markdown 标记与首尾标点后按码点截断。
 * 返回空串表示该文本不可用作标题（纯符号 / 结构性词 / 无有效内容）。
 * 同时用于 LLM 生成结果的清洗与首条消息的兜底标题推导。
 */
export function normalizeTitle(raw: string, maxLen = 14): string {
  const lines = raw.replace(/```[\s\S]*?```/g, "\n").split(/\r?\n/)
  for (const line of lines) {
    const cleaned = cleanTitleText(line)
    if (Array.from(cleaned).length < 2) continue
    if (isStructuralOnly(cleaned)) continue
    return truncateTitle(cleaned, maxLen)
  }
  return ""
}
