/**
 * cron 表达式工具 (M5)
 * - 校验 5 段 cron
 * - 计算下次执行时间（秒级时间戳）
 * - LLM 自然语言 → cron
 */
import * as cronParserModule from "cron-parser"
import { llmJson } from "../agent/llm-helper"

// cron-parser 是 CJS（package.json 无 type/exports）：打包后命名导出可用，
// 但 tsx/原生 Node ESM 下只有 default 函数，两种环境都兼容
const cronParser = (cronParserModule as { default?: typeof cronParserModule }).default ?? cronParserModule
const { parseExpression } = cronParser

/** 校验 cron（5 段: 分 时 日 月 周） */
export function validateCron(expr: string): boolean {
  try {
    parseExpression(expr.trim())
    return true
  } catch {
    return false
  }
}

/**
 * 计算下次执行时间（秒级时间戳）
 * @param cronExpr 5 段 cron
 * @param fromMs 起点（默认当前）
 */
export function computeNextRunSeconds(cronExpr: string, fromMs: number = Date.now()): number | null {
  try {
    const interval = parseExpression(cronExpr.trim(), { currentDate: new Date(fromMs) })
    return Math.floor(interval.next().toDate().getTime() / 1000)
  } catch {
    return null
  }
}

interface CronParseResult {
  cron: string
  /** 对调度规则的中文说明（如"每天 09:00"） */
  note: string
}

const PARSE_SYSTEM = `你是 cron 表达式生成器。把用户的中文/英文自然语言时间描述转成标准 5 段 cron 表达式（分 时 日 月 周）。

规则：
- 只支持标准 cron：分钟 0-59，小时 0-23，日 1-31，月 1-12，周 0-6（0=周日）
- 不支持 @daily 等别名、不支持秒、不支持年
- 中文示例：
  "每天早上9点" → "0 9 * * *"
  "每小时整点" → "0 * * * *"
  "每周五下午5点" → "0 17 * * 5"
  "工作日每天9点半" → "30 9 * * 1-5"
  "每隔15分钟" → "*/15 * * * *"
  "每月1号上午10点" → "0 10 1 * *"
  "每天中午12点和晚上6点" → "0 12,18 * * *"

只输出 JSON: {"cron": "5段表达式", "note": "中文人话说明"}
如果描述模糊无法确定，cron 输出空字符串并在 note 里说明缺什么信息。`

/** 自然语言 → cron；无法确定时 cron 为空字符串 */
export async function parseScheduleToCron(naturalText: string): Promise<CronParseResult> {
  // 若本身就是合法 cron，直接用，note 留给调用方展示原文
  const trimmed = naturalText.trim()
  if (/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(trimmed) && validateCron(trimmed)) {
    return { cron: trimmed, note: "cron 表达式" }
  }
  const result = await llmJson<CronParseResult>(PARSE_SYSTEM, naturalText, { temperature: 0.1, maxTokens: 200 })
  if (!result?.cron || !validateCron(result.cron)) {
    return { cron: "", note: result?.note || "无法从描述中确定执行时间" }
  }
  return { cron: result.cron.trim(), note: result.note || trimmed }
}
