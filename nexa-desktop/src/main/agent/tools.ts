/**
 * 内置基础工具集: read / write / edit / bash
 * 对齐 pi-coding-agent 的 4 个核心工具，typebox schema 定义
 *
 * 安全边界:
 * - read/write/edit 强制路径在 workspace 内
 * - bash 在 workspace 目录执行，默认 120s 超时
 */
import { exec } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { promisify } from "node:util"
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"

const execAsync = promisify(exec)

/** 校验路径在 workspace 内，返回绝对路径；越界抛异常 */
function assertInWorkspace(workspacePath: string, p: string): string {
  if (!isAbsolute(p)) {
    p = resolve(workspacePath, p)
  }
  const abs = resolve(p)
  const rel = relative(workspacePath, abs)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`路径越界: ${p} 不在工作目录 ${workspacePath} 内`)
  }
  return abs
}

// 注: 工具失败一律 throw —— pi-agent-core 只把抛出的异常判为 isError，
// 返回值里的 isError 字段会被忽略（agent-loop.js executeTool 返回 isError: false）

// ==========================================
// read 工具
// ==========================================
const readParams = Type.Object({
  path: Type.String({ description: "文件路径（相对工作目录或绝对路径，必须在工作目录内）" }),
  offset: Type.Optional(Type.Number({ description: "起始行号（从 1 开始）" })),
  limit: Type.Optional(Type.Number({ description: "读取行数，默认 2000" })),
})

export function createReadTool(workspacePath: string): AgentTool<typeof readParams> {
  return {
    name: "read",
    label: "读取文件",
    description: "读取工作目录内的文件内容。可选按行偏移和行数分段读取大文件。",
    parameters: readParams,
    execute: async (_id, params) => {
      try {
        const abs = assertInWorkspace(workspacePath, params.path)
        if (!existsSync(abs)) throw new Error(`文件不存在: ${params.path}`)
        if (!statSync(abs).isFile()) throw new Error(`不是文件: ${params.path}`)
        const raw = readFileSync(abs, "utf8")
        const lines = raw.split("\n")
        const offset = Math.max(1, params.offset ?? 1)
        const limit = Math.min(params.limit ?? 2000, 2000)
        const slice = lines.slice(offset - 1, offset - 1 + limit)
        const numbered = slice.map((line, i) => `${String(offset + i).padStart(5)}→${line}`).join("\n")
        return {
          content: [{ type: "text", text: numbered || "(空文件)" }],
          details: { path: abs, lines: slice.length },
        }
      } catch (err) {
        throw err
      }
    },
  }
}

// ==========================================
// write 工具
// ==========================================
const writeParams = Type.Object({
  path: Type.String({ description: "文件路径（相对工作目录或绝对路径，必须在工作目录内）" }),
  content: Type.String({ description: "完整文件内容" }),
})

export function createWriteTool(workspacePath: string): AgentTool<typeof writeParams> {
  return {
    name: "write",
    label: "写入文件",
    description: "创建或覆盖工作目录内的文件。父目录自动创建。",
    parameters: writeParams,
    execute: async (_id, params) => {
      try {
        const abs = assertInWorkspace(workspacePath, params.path)
        mkdirSync(resolve(abs, ".."), { recursive: true })
        writeFileSync(abs, params.content, "utf8")
        return {
          content: [{ type: "text", text: `已写入 ${params.path}（${params.content.length} 字符）` }],
          details: { path: abs, bytes: Buffer.byteLength(params.content) },
        }
      } catch (err) {
        throw err
      }
    },
  }
}

// ==========================================
// edit 工具
// ==========================================
const editParams = Type.Object({
  path: Type.String({ description: "文件路径（相对工作目录或绝对路径，必须在工作目录内）" }),
  oldText: Type.String({ description: "要替换的原文（必须在文件中唯一）" }),
  newText: Type.String({ description: "替换后的文本" }),
})

export function createEditTool(workspacePath: string): AgentTool<typeof editParams> {
  return {
    name: "edit",
    label: "编辑文件",
    description: "对文件做精确字符串替换。oldText 必须在文件中恰好出现一次。",
    parameters: editParams,
    execute: async (_id, params) => {
      try {
        const abs = assertInWorkspace(workspacePath, params.path)
        if (!existsSync(abs)) throw new Error(`文件不存在: ${params.path}`)
        const raw = readFileSync(abs, "utf8")
        const count = raw.split(params.oldText).length - 1
        if (count === 0) throw new Error("oldText 在文件中未找到")
        if (count > 1) throw new Error(`oldText 在文件中出现 ${count} 次，请提供更长的上下文使其唯一`)
        writeFileSync(abs, raw.replace(params.oldText, params.newText), "utf8")
        return {
          content: [{ type: "text", text: `已编辑 ${params.path}` }],
          details: { path: abs },
        }
      } catch (err) {
        throw err
      }
    },
  }
}

// ==========================================
// bash 工具
// ==========================================
const BASH_DEFAULT_TIMEOUT = 120_000
const BASH_MAX_TIMEOUT = 600_000
const BASH_MAX_OUTPUT = 50 * 1024 // 50KB 截断

const bashParams = Type.Object({
  command: Type.String({ description: "要执行的 shell 命令" }),
  timeout: Type.Optional(Type.Number({ description: "超时毫秒数，默认 120000，最大 600000" })),
})

export function createBashTool(workspacePath: string, defaultTimeout?: number): AgentTool<typeof bashParams> {
  return {
    name: "bash",
    label: "执行命令",
    description: "在工作目录内执行 shell 命令，返回 stdout/stderr。",
    parameters: bashParams,
    execute: async (_id, params) => {
      const timeout = Math.min(Math.max(params.timeout ?? defaultTimeout ?? BASH_DEFAULT_TIMEOUT, 1000), BASH_MAX_TIMEOUT)
      const startedAt = Date.now()
      try {
        const { stdout, stderr } = await execAsync(params.command, {
          cwd: workspacePath,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, TERM: "dumb" },
        })
        const out = truncateOutput(stdout, stderr, false)
        return { content: [{ type: "text", text: out }], details: { durationMs: Date.now() - startedAt } }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; killed?: boolean; message: string }
        // 命令有输出但退出码非 0：输出仍然有效。
        // 必须 throw（pi 只把异常判为 isError，返回值里的 isError 字段会被忽略），输出嵌入异常消息保留给 LLM
        if (e.stdout || e.stderr) {
          const out = truncateOutput(e.stdout ?? "", e.stderr ?? "", true)
          throw new Error(`命令执行失败(${e.killed ? "timeout" : "exit non-zero"}):\n${out}`)
        }
        throw err
      }
    },
  }
}

function truncateOutput(stdout: string, stderr: string, failed: boolean): string {
  let text = ""
  if (stdout.trim()) text += stdout.trim()
  if (stderr.trim()) text += (text ? "\n--- stderr ---\n" : "") + stderr.trim()
  if (!text) text = failed ? "(命令失败，无输出)" : "(无输出)"
  if (text.length > BASH_MAX_OUTPUT) {
    text = text.slice(0, BASH_MAX_OUTPUT) + `\n... (输出过长已截断，共 ${text.length} 字符)`
  }
  return text
}

/** 组装 workspace 全套基础工具（bashTimeout 来自专家 dispatch_strategy.step_timeout_seconds） */
export function createBuiltinTools(workspacePath: string, bashTimeout?: number): AgentTool[] {
  return [createReadTool(workspacePath), createWriteTool(workspacePath), createEditTool(workspacePath), createBashTool(workspacePath, bashTimeout)]
}
