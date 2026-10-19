/**
 * 专家注册表 —— 内置专家 + 用户自定义专家（~/.nexa/experts/*.yaml）统一管理
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse, stringify } from "yaml"
import { BUILTIN_EXPERTS } from "./builtin"
import type { Expert, ExpertInfo, ExpertDispatchStrategy } from "./types"
import type { ExpertDetail, ExpertSaveParams } from "@shared/ipc-channels"

/** 用户专家目录 */
export function expertsDir(): string {
  return join(homedir(), ".nexa", "experts")
}

export class ExpertRegistry {
  constructor() {
    if (!existsSync(expertsDir())) {
      mkdirSync(expertsDir(), { recursive: true })
    }
  }

  /** 全量专家（内置在前，用户按文件名排序） */
  list(): Expert[] {
    return [...BUILTIN_EXPERTS, ...this.listUser()]
  }

  /** 渲染进程可见信息（不含 systemPrompt） */
  listInfo(): ExpertInfo[] {
    return this.list().map(toInfo)
  }

  /** 按 id 查找；不存在返回 null */
  get(id: string | null | undefined): Expert | null {
    if (!id) return null
    return this.list().find((e) => e.id === id) ?? null
  }

  /** 默认专家（通用助手） */
  getDefault(): Expert {
    return BUILTIN_EXPERTS[0]
  }

  /** 专家详情（编辑用，含 systemPrompt）；内置专家从内存取，用户专家重读 yaml */
  getDetail(id: string): ExpertDetail | null {
    const e = this.get(id)
    if (!e) return null
    return { ...toInfo(e), systemPrompt: e.systemPrompt }
  }

  /** 保存用户专家（结构化字段 → yaml）；内置专家禁止修改 */
  save(params: ExpertSaveParams): string {
    const id = params.id ?? slugify(params.name)
    if (BUILTIN_EXPERTS.some((b) => b.id === id)) throw new Error("内置专家不可修改，请新建自定义专家")
    if (!params.name.trim() || !params.systemPrompt.trim()) throw new Error("name 与 system_prompt 不能为空")
    const doc: Record<string, unknown> = {
      name: params.name.trim(),
      description: params.description.trim(),
      system_prompt: params.systemPrompt,
    }
    if (params.tools?.length) doc.tools = params.tools
    if (params.disallowTools?.length) doc.disallow_tools = params.disallowTools
    const yamlText = stringify(doc)
    if (!existsSync(expertsDir())) mkdirSync(expertsDir(), { recursive: true })
    writeFileSync(join(expertsDir(), `${id}.yaml`), yamlText, "utf8")
    return id
  }

  /** 删除用户专家；内置专家禁止删除 */
  delete(id: string): boolean {
    if (BUILTIN_EXPERTS.some((b) => b.id === id)) throw new Error("内置专家不可删除")
    const filePath = join(expertsDir(), `${id}.yaml`)
    if (!existsSync(filePath)) return false
    unlinkSync(filePath)
    return true
  }

  private listUser(): Expert[] {
    const dir = expertsDir()
    if (!existsSync(dir)) return []
    const experts: Expert[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue
      try {
        const expert = parseUserExpert(join(dir, file))
        if (expert) experts.push(expert)
      } catch {
        // 单个专家文件损坏不阻塞其他专家加载
      }
    }
    return experts.sort((a, b) => a.id.localeCompare(b.id))
  }
}

/** 解析单个用户专家 yaml；缺 name/system_prompt 视为无效 */
export function parseUserExpert(filePath: string): Expert | null {
  const raw = readFileSync(filePath, "utf8")
  const doc = parse(raw) as Record<string, unknown> | null
  if (!doc || typeof doc !== "object") return null
  const name = typeof doc.name === "string" ? doc.name.trim() : ""
  const systemPrompt = typeof doc.system_prompt === "string" ? doc.system_prompt : ""
  if (!name || !systemPrompt.trim()) return null

  const base = filePath.split("/").pop()!.replace(/\.ya?ml$/, "")
  const strategy = normalizeStrategy(doc.dispatch_strategy)
  return {
    id: base,
    name,
    description: typeof doc.description === "string" ? doc.description : "",
    systemPrompt,
    tools: Array.isArray(doc.tools) ? doc.tools.filter((t): t is string => typeof t === "string") : undefined,
    disallowTools: Array.isArray(doc.disallow_tools)
      ? doc.disallow_tools.filter((t): t is string => typeof t === "string")
      : undefined,
    dispatchStrategy: strategy,
    builtin: false,
    filePath,
  }
}

function normalizeStrategy(raw: unknown): ExpertDispatchStrategy | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const s = raw as Record<string, unknown>
  const out: ExpertDispatchStrategy = {}
  if (typeof s.max_steps === "number") out.maxSteps = s.max_steps
  if (typeof s.allow_parallel === "boolean") out.allowParallel = s.allow_parallel
  if (typeof s.step_timeout_seconds === "number") out.stepTimeoutSeconds = s.step_timeout_seconds
  if (s.memory_profile === "concise" || s.memory_profile === "detail" || s.memory_profile === "full") {
    out.memoryProfile = s.memory_profile
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function toInfo(e: Expert): ExpertInfo {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    tools: e.tools,
    disallowTools: e.disallowTools,
    dispatchStrategy: e.dispatchStrategy,
    builtin: e.builtin,
  }
}

/** 名字 → 文件名 slug（保留中文字符） */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[\\/:*?"<>|.]/g, "") || `expert-${Date.now()}`
}
