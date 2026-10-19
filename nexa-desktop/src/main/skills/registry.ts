/**
 * Skill 注册表 —— 扫描 ~/.nexa/skills/<id>/skill.yaml + 内置 Skill 落盘
 * 启用/禁用状态存 ~/.nexa/skills/.state.json（避免回写破坏用户 yaml 格式）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import { BUILTIN_SKILLS } from "./builtin"
import type { Skill, SkillInfo, SkillInputSpec, SkillRunResult } from "./types"
import type { SkillDetail } from "@shared/ipc-channels"

export function skillsDir(): string {
  return join(homedir(), ".nexa", "skills")
}

const STATE_FILE = join(skillsDir(), ".state.json")

/** 读取启用状态（缺省启用） */
function loadState(): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    return {}
  }
}

export class SkillRegistry {
  constructor() {
    ensureDir()
    this.materializeBuiltins()
  }

  list(): Skill[] {
    return [...this.listBuiltin(), ...this.listUser()]
  }

  listInfo(): SkillInfo[] {
    const state = loadState()
    return this.list().map((s) => ({ ...toInfo(s), enabled: state[s.id] !== false }))
  }

  /** 按 id 查找；不存在或已禁用返回 null（禁用 = Agent 不可见不可调） */
  getRunnable(id: string): Skill | null {
    const state = loadState()
    if (state[id] === false) return null
    return this.list().find((s) => s.id === id) ?? null
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const exists = this.list().some((s) => s.id === id)
    if (!exists) return false
    const state = loadState()
    if (enabled) delete state[id]
    else state[id] = false
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    return true
  }

  /** 内置 Skill id 集合 */
  isBuiltin(id: string): boolean {
    return BUILTIN_SKILLS.some((b) => b.id === id)
  }

  /**
   * 删除用户 Skill（整个目录连带 entry 一并删除）。
   * 内置 Skill 由应用随包提供，禁止删除（只能通过 setEnabled 停用）；
   * 应用升级时 materializeBuiltins 会重新校验内置目录，删除会导致行为不一致。
   */
  remove(id: string): boolean {
    if (!/^[\w-]+$/.test(id)) throw new Error("非法 Skill id")
    if (this.isBuiltin(id)) throw new Error("内置 Skill 不可删除，可在列表中停用")
    const dir = join(skillsDir(), id)
    if (!existsSync(dir)) return false
    rmSync(dir, { recursive: true, force: true })
    // 清理该 Skill 的启用状态残留，避免同名重建后继承旧的禁用状态
    const state = loadState()
    if (id in state) {
      delete state[id]
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8")
    }
    return true
  }

  /** Skill 详情（yaml 原文 + enabled） */
  getDetail(id: string): SkillDetail | null {
    const dir = join(skillsDir(), id)
    const yamlPath = join(dir, "skill.yaml")
    if (!existsSync(yamlPath)) return null
    const parsed = parseSkillDir(dir, BUILTIN_SKILLS.some((b) => b.id === id))
    if (!parsed) return null
    const state = loadState()
    return { ...toInfo(parsed), enabled: state[id] !== false, yaml: readFileSync(yamlPath, "utf8") }
  }

  /**
   * 保存 skill.yaml（解析校验后写入）
   * 新建（目录不存在）时同时生成 entry 骨架；entry 指向的文件不存在也补骨架
   */
  saveYaml(id: string, yamlText: string): void {
    if (!/^[\w-]+$/.test(id)) throw new Error("Skill id 只能包含字母、数字、下划线和连字符")
    const doc = parse(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") throw new Error("YAML 解析失败")
    if (typeof doc.name !== "string" || !doc.name.trim()) throw new Error("yaml 缺少 name 字段")
    const entryRel = typeof doc.entry === "string" ? doc.entry : ""
    if (!entryRel) throw new Error("yaml 缺少 entry 字段")
    const dir = join(skillsDir(), id)
    const entryPath = resolve(dir, entryRel)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "skill.yaml"), yamlText, "utf8")
    if (!existsSync(entryPath)) {
      // 生成 entry 骨架（stdin JSON / stdout JSON 协议）
      writeFileSync(
        entryPath,
        `#!/usr/bin/env node\n// Skill entry 骨架: stdin 收 JSON {inputs}，stdout 出 JSON {ok, message, files}\nconst fs = require("fs");\nlet raw = "";\nprocess.stdin.on("data", (d) => (raw += d));\nprocess.stdin.on("end", () => {\n  const { inputs = {} } = JSON.parse(raw || "{}");\n  // TODO: 在这里实现 Skill 逻辑（cwd 为会话 workspace）\n  process.stdout.write(JSON.stringify({ ok: true, message: "Skill 未实现", files: [] }));\n});\n`,
        "utf8"
      )
    }
  }

  /** 内置 Skill 落盘：目录不存在时写入 yaml + entry（已存在不覆盖） */
  private materializeBuiltins(): void {
    for (const b of BUILTIN_SKILLS) {
      const dir = join(skillsDir(), b.id)
      if (existsSync(join(dir, "skill.yaml"))) continue
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "skill.yaml"), b.yaml, "utf8")
      writeFileSync(join(dir, "index.js"), b.entry, "utf8")
    }
  }

  /** 内置 Skill 同样从磁盘读（启动时已落盘），保证行为与用户 Skill 一致 */
  private listBuiltin(): Skill[] {
    const out: Skill[] = []
    for (const b of BUILTIN_SKILLS) {
      try {
        const s = parseSkillDir(join(skillsDir(), b.id), true)
        if (s) out.push(s)
      } catch {
        /* 单个 Skill 损坏不阻塞其他加载 */
      }
    }
    return out
  }

  private listUser(): Skill[] {
    const dir = skillsDir()
    if (!existsSync(dir)) return []
    const builtinIds = new Set(BUILTIN_SKILLS.map((b) => b.id))
    const out: Skill[] = []
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory() || name.name.startsWith(".") || builtinIds.has(name.name)) continue
      try {
        const s = parseSkillDir(join(dir, name.name), false)
        if (s) out.push(s)
      } catch {
        /* 单个 Skill 损坏不阻塞其他加载 */
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }
}

function ensureDir(): void {
  if (!existsSync(skillsDir())) mkdirSync(skillsDir(), { recursive: true })
}

/** 解析单个 Skill 目录（skill.yaml + entry） */
function parseSkillDir(dir: string, builtin: boolean): Skill | null {
  const yamlPath = join(dir, "skill.yaml")
  if (!existsSync(yamlPath)) return null
  const doc = parse(readFileSync(yamlPath, "utf8")) as Record<string, unknown> | null
  if (!doc || typeof doc !== "object") return null
  const name = typeof doc.name === "string" ? doc.name.trim() : ""
  const entryRel = typeof doc.entry === "string" ? doc.entry : ""
  if (!name || !entryRel) return null
  const entryPath = resolve(dir, entryRel)
  if (!existsSync(entryPath)) return null
  return {
    id: dir.split("/").pop()!,
    name,
    description: typeof doc.description === "string" ? doc.description : "",
    version: typeof doc.version === "string" ? doc.version : "0.0.0",
    entryPath,
    inputs: Array.isArray(doc.inputs) ? (doc.inputs as SkillInputSpec[]) : [],
    outputs: Array.isArray(doc.outputs) ? doc.outputs.filter((o): o is string => typeof o === "string") : [],
    promptHint: typeof doc.prompt_hint === "string" ? doc.prompt_hint : undefined,
    builtin,
    enabled: true, // 实际启用状态由 .state.json 决定（见 getRunnable）
  }
}

function toInfo(s: Skill): SkillInfo {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    version: s.version,
    inputs: s.inputs,
    outputs: s.outputs,
    promptHint: s.promptHint,
    builtin: s.builtin,
    enabled: true, // listInfo 中会被 state 覆盖
  }
}

// ===== Runner: Node 子进程隔离执行 =====

const RUN_TIMEOUT_MS = 60_000
const MAX_OUTPUT = 50 * 1024

/**
 * 执行 Skill: spawn Node 子进程（ELECTRON_RUN_AS_NODE 保证 Electron 二进制以纯 Node 模式运行）
 * stdin 传 JSON {inputs}，stdout 收 JSON {ok, message, files}
 * cwd 为会话 workspace —— Skill 用相对路径写的文件直接进产物面板
 */
export function runSkill(skill: Skill, inputs: Record<string, unknown>, cwd: string): Promise<SkillRunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [skill.entryPath], {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill("SIGKILL")
        resolve({ ok: false, message: "", error: `Skill 执行超时（${RUN_TIMEOUT_MS / 1000}s）` })
      }
    }, RUN_TIMEOUT_MS)

    child.stdout.on("data", (d: Buffer) => (out += d.toString()))
    child.stderr.on("data", (d: Buffer) => (err += d.toString()))
    child.on("error", (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, message: "", error: `Skill 进程启动失败: ${e.message}` })
    })
    child.on("close", () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let text = out.trim() || err.trim()
      if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + `...(输出过长已截断，共 ${text.length} 字符)`
      try {
        const parsed = JSON.parse(out.trim()) as SkillRunResult
        resolve({ ...parsed, message: parsed.message ?? "", files: parsed.files ?? [] })
      } catch {
        resolve({ ok: false, message: text || "(无输出)", error: "Skill 未返回合法 JSON 结果" })
      }
    })
    child.stdin.write(JSON.stringify({ inputs }))
    child.stdin.end()
  })
}
