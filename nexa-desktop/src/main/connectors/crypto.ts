/**
 * 连接器凭据加密 —— Node 内置 crypto AES-256-GCM
 *
 * 密钥: ~/.nexa/.secret（首启生成 32 字节 hex，0600 权限）
 * 密文格式: enc:v1:<iv_b64>:<tag_b64>:<data_b64>
 * 明文兼容: decrypt 遇到非 enc: 前缀原样返回（用户手写 yaml 可直接写明文）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const SECRET_FILE = join(homedir(), ".nexa", ".secret")
const ENC_PREFIX = "enc:v1:"

function getMasterKey(): Buffer {
  if (!existsSync(SECRET_FILE)) {
    mkdirSync(join(homedir(), ".nexa"), { recursive: true })
    writeFileSync(SECRET_FILE, randomBytes(32).toString("hex"), { mode: 0o600 })
    chmodSync(SECRET_FILE, 0o600)
  }
  return Buffer.from(readFileSync(SECRET_FILE, "utf8").trim(), "hex")
}

/** 加密明文凭据 → enc:v1:... 密文 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`
}

/** 解密凭据；非 enc: 前缀视为明文原样返回 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value
  try {
    const [ivB64, tagB64, dataB64] = value.slice(ENC_PREFIX.length).split(":")
    const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), Buffer.from(ivB64, "base64"))
    decipher.setAuthTag(Buffer.from(tagB64, "base64"))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
  } catch (err) {
    throw new Error("凭据解密失败（密钥不匹配或密文损坏），请重新配置该连接器的 secrets")
  }
}

/** 是否为加密值 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX)
}
