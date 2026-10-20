/**
 * 中继数据存储（JSON 文件持久化）
 *
 * 中继不存业务内容，只存配对关系，数据量极小，无需 SQLite：
 * - pending: 待确认配对码（10 分钟有效，一次性）
 * - pairings: 已确认的 desktop ↔ phone 配对（含 phone 重连 token）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { join } from "node:path"

const DATA_DIR = process.env.RELAY_DATA_DIR || join(__dirname, "..", "data")
const DATA_FILE = join(DATA_DIR, "relay-data.json")

export interface PendingPairing {
  code: string
  desktopId: string
  desktopName: string
  createdAt: number
  expiresAt: number
}

export interface ConfirmedPairing {
  desktopId: string
  desktopName: string
  phoneId: string
  phoneName: string
  token: string
  pairedAt: number
}

interface RelayData {
  pending: PendingPairing[]
  pairings: ConfirmedPairing[]
}

let data: RelayData = { pending: [], pairings: [] }
let saveTimer: NodeJS.Timeout | null = null

export function loadStore(): RelayData {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"))
      data = {
        pending: Array.isArray(raw.pending) ? raw.pending : [],
        pairings: Array.isArray(raw.pairings) ? raw.pairings : [],
      }
      // 启动即清理过期 pending
      pruneExpired()
    }
  } catch {
    data = { pending: [], pairings: [] }
  }
  return data
}

/** 防抖落盘（高频消息路由不写盘，仅配对状态变更时写） */
function persist(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      const tmp = `${DATA_FILE}.tmp`
      writeFileSync(tmp, JSON.stringify(data, null, 2))
      renameSync(tmp, DATA_FILE)
    } catch {
      /* 落盘失败不影响内存路由 */
    }
  }, 200)
}

function pruneExpired(): void {
  const now = Date.now()
  const before = data.pending.length
  data.pending = data.pending.filter((p) => p.expiresAt > now)
  if (data.pending.length !== before) persist()
}

// ===== pending 配对码 =====

export function addPending(entry: PendingPairing): void {
  pruneExpired()
  // 同一 desktop 只保留一个待确认码（重新生成即作废旧码）
  data.pending = data.pending.filter((p) => p.desktopId !== entry.desktopId)
  data.pending.push(entry)
  persist()
}

export function consumePending(code: string): PendingPairing | null {
  pruneExpired()
  const idx = data.pending.findIndex((p) => p.code === code)
  if (idx === -1) return null
  const [entry] = data.pending.splice(idx, 1)
  persist()
  return entry
}

export function getPendingByDesktop(desktopId: string): PendingPairing | null {
  pruneExpired()
  return data.pending.find((p) => p.desktopId === desktopId) ?? null
}

// ===== 已确认配对 =====

export function addPairing(entry: ConfirmedPairing): void {
  // 同一台手机重复配对：覆盖旧关系（换电脑场景）
  data.pairings = data.pairings.filter((p) => p.phoneId !== entry.phoneId)
  data.pairings.push(entry)
  persist()
}

export function findPairingByPhone(phoneId: string): ConfirmedPairing | null {
  return data.pairings.find((p) => p.phoneId === phoneId) ?? null
}

export function findPairingByToken(token: string): ConfirmedPairing | null {
  return data.pairings.find((p) => p.token === token) ?? null
}

export function listPairingsByDesktop(desktopId: string): ConfirmedPairing[] {
  return data.pairings.filter((p) => p.desktopId === desktopId)
}

export function removePairing(desktopId: string, phoneId: string): boolean {
  const before = data.pairings.length
  data.pairings = data.pairings.filter((p) => !(p.desktopId === desktopId && p.phoneId === phoneId))
  if (data.pairings.length !== before) persist()
  return before !== data.pairings.length
}

export function removePairingByPhone(phoneId: string): void {
  const before = data.pairings.length
  data.pairings = data.pairings.filter((p) => p.phoneId !== phoneId)
  if (data.pairings.length !== before) persist()
}
