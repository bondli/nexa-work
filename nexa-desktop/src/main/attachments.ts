/**
 * 会话消息附件（粘贴 / 拖拽的图片）落盘与回读
 *
 * 存放于 ~/.nexa/uploads/<sessionId>/ —— 不放 workspace：project 模式下会污染用户仓库，
 * 且附件是「输入」而非「产物」，不应出现在产物面板里。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"
import type { AttachmentInput, ChatAttachment } from "@shared/ipc-channels"

export function uploadsDir(): string {
  return join(homedir(), ".nexa", "uploads")
}

/** 支持的图片 MIME（仅图片附件，其余类型忽略） */
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"])

/** 单张图片上限 10MB（base64 后约 13MB，避免 IPC 传输过大） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 文件名安全化（去掉路径分隔符等，保留扩展名） */
function safeName(name: string): string {
  const cleaned = name.replace(/[^\w.-]/g, "_").slice(-60)
  return cleaned || "image.png"
}

/** dataURL → { mimeType, buffer } */
function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  try {
    return { mimeType: m[1].toLowerCase(), buffer: Buffer.from(m[2], "base64") }
  } catch {
    return null
  }
}

/** 落盘一批附件并返回持久化描述（非法格式 / 非图片 / 超限的项直接跳过） */
export function saveAttachments(sessionId: string, inputs: AttachmentInput[] | undefined): ChatAttachment[] {
  if (!inputs?.length) return []
  const dir = join(uploadsDir(), sessionId)
  mkdirSync(dir, { recursive: true })
  const out: ChatAttachment[] = []
  inputs.forEach((input, i) => {
    const parsed = parseDataUrl(input.dataUrl)
    if (!parsed) return
    const mimeType = IMAGE_MIME.has(parsed.mimeType) ? parsed.mimeType : input.mimeType.toLowerCase()
    if (!IMAGE_MIME.has(mimeType)) return
    if (parsed.buffer.byteLength > MAX_IMAGE_BYTES) return
    const filePath = join(dir, `${Date.now()}-${i}-${safeName(input.name)}`)
    writeFileSync(filePath, parsed.buffer)
    out.push({ path: filePath, name: input.name || safeName(input.name), mimeType, size: parsed.buffer.byteLength })
  })
  return out
}

/**
 * 读取附件为 dataURL（渲染端展示缩略图用）。
 * 仅允许 uploads 目录内的文件，避免渲染端借该接口读取任意本地文件。
 */
export function readAttachmentDataUrl(filePath: string): string | null {
  const root = resolve(uploadsDir())
  const target = resolve(filePath)
  if (target !== root && !target.startsWith(root + sep)) return null
  if (!existsSync(target)) return null
  try {
    const buf = readFileSync(target)
    const ext = target.slice(target.lastIndexOf(".") + 1).toLowerCase()
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`
    return `data:${mime};base64,${buf.toString("base64")}`
  } catch {
    return null
  }
}
