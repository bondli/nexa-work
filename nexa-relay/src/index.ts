/**
 * Nexa 中继服务
 *
 * 桌面端 ←── WebSocket ──► 本服务 ◄── WebSocket ──► 手机端
 *
 * 职责：
 * 1. 配对管理：桌面端 REST 申请 6 位配对码（10 分钟一次性），手机端带码连 WS 完成配对
 * 2. 消息路由：配对设备间透传业务消息，中继不解析/不持久化业务内容
 * 3. 连接管理：心跳保活、上下线通知、手机重连 token
 *
 * 消息信封（JSON）：
 *   { type, id?, timestamp, payload? }
 * 中继在转发时注入 sender: { deviceId, name, role }
 *
 * 系统消息（type 以 relay: 开头）：
 *   下行 relay:hello / relay:paired / relay:peer-online / relay:peer-offline /
 *        relay:pong / relay:error
 *   上行 relay:ping / relay:unbind
 *
 * 环境变量：
 *   PORT             监听端口（默认 8787）
 *   RELAY_DATA_DIR   配对数据目录（默认 ./data）
 *   CODE_TTL_MS      配对码有效期（默认 10 分钟）
 */
import http from "node:http"
import { randomBytes } from "node:crypto"
import express, { Request, Response } from "express"
import { WebSocketServer, WebSocket } from "ws"
import {
  loadStore,
  addPending,
  consumePending,
  getPendingByDesktop,
  addPairing,
  findPairingByPhone,
  findPairingByToken,
  listPairingsByDesktop,
  removePairing,
  type ConfirmedPairing,
} from "./store"

const PORT = Number(process.env.PORT ?? 8787)
const CODE_TTL_MS = Number(process.env.CODE_TTL_MS ?? 10 * 60 * 1000)
const HEARTBEAT_MS = 30_000
/** 配对码字母表：去除易混淆字符 0/O、1/I */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

type Role = "desktop" | "phone"

interface Connection {
  ws: WebSocket
  role: Role
  deviceId: string
  name: string
  isAlive: boolean
  token: string | null
}

loadStore()

const app = express()
app.use(express.json({ limit: "64kb" }))

// 极简限流：每 IP 每分钟最多 30 次 REST
const restHits = new Map<string, { start: number; count: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const win = restHits.get(ip)
  if (!win || now - win.start > 60_000) {
    restHits.set(ip, { start: now, count: 1 })
    return false
  }
  win.count++
  return win.count > 30
}
setInterval(() => {
  const now = Date.now()
  for (const [ip, win] of restHits) {
    if (now - win.start > 60_000) restHits.delete(ip)
  }
}, 60_000).unref?.()

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

app.get("/health", (_req: Request, res: Response) => {
  let desktops = 0
  let phones = 0
  for (const conn of connections.values()) {
    if (conn.role === "desktop") desktops++
    else phones++
  }
  res.json({ ok: true, ts: nowSec(), connections: { desktops, phones } })
})

/**
 * 桌面端创建配对码
 * body: { deviceId: string, deviceName?: string }
 */
app.post("/api/pairing", (req: Request, res: Response) => {
  if (rateLimited(req.ip ?? "")) return res.status(429).json({ error: "请求过于频繁" })
  const deviceId = String(req.body?.deviceId ?? "").trim()
  const deviceName = String(req.body?.deviceName ?? "").trim().slice(0, 64)
  if (!deviceId || deviceId.length > 64) {
    return res.status(400).json({ error: "deviceId 无效" })
  }
  const code = generateCode()
  const now = Date.now()
  addPending({ code, desktopId: deviceId, desktopName: deviceName || deviceId, createdAt: now, expiresAt: now + CODE_TTL_MS })
  // 桌面端若在线，立刻推送 pending 状态（让 UI 倒计时）
  const desktop = getConnection("desktop", deviceId)
  if (desktop) send(desktop.ws, "relay:pairing-pending", { code, expiresAt: now + CODE_TTL_MS })
  res.json({ code, expiresAt: now + CODE_TTL_MS, ttlMs: CODE_TTL_MS })
})

const server = http.createServer(app)
// 512KB 会把带正文/图片的消息直接掐断（ws 收到超限帧即断连），放宽到 4MB
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4 * 1024 * 1024 })

/**
 * 连接注册表
 * key = `${role}:${deviceId}` → Connection
 */
const connections = new Map<string, Connection>()
const keyOf = (role: Role, deviceId: string): string => `${role}:${deviceId}`

function getConnection(role: Role, deviceId: string): Connection | null {
  return connections.get(keyOf(role, deviceId)) ?? null
}

function generateCode(): string {
  let code = ""
  const bytes = randomBytes(6)
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return code
}

function generateToken(): string {
  return randomBytes(24).toString("hex")
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function send(ws: WebSocket, type: string, payload: Record<string, JsonValue> = {}, extra: Record<string, JsonValue> = {}): void {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify({ type, timestamp: nowSec(), payload, ...extra }))
}

function sendError(ws: WebSocket, message: string, refId?: string | number): void {
  send(ws, "relay:error", { message }, refId !== undefined ? { id: refId as unknown as JsonValue } : {})
}

// ===== WebSocket 接入 =====
wss.on("connection", (ws: WebSocket, req) => {
  let params: URLSearchParams
  try {
    params = new URL(req.url ?? "/", "http://localhost").searchParams
  } catch {
    sendError(ws, "URL 无效"); ws.close(4001); return
  }

  const role = params.get("role") as Role | null
  const deviceId = (params.get("deviceId") ?? "").trim()
  const deviceName = (params.get("name") ?? "").trim().slice(0, 64) || deviceId

  if (!["desktop", "phone"].includes(role ?? "") || !deviceId || deviceId.length > 64) {
    sendError(ws, "role 必须为 desktop/phone，且 deviceId 必填")
    ws.close(4002)
    return
  }

  // 手机端鉴权：配对码（首次）或 token（重连）
  let pairing: ConfirmedPairing | null = null
  if (role === "phone") {
    const code = (params.get("code") ?? "").toUpperCase().trim()
    const token = params.get("token") ?? ""
    if (code) {
      const pending = consumePending(code)
      if (!pending) {
        sendError(ws, "配对码无效或已过期")
        ws.close(4003)
        return
      }
      pairing = {
        desktopId: pending.desktopId,
        desktopName: pending.desktopName,
        phoneId: deviceId,
        phoneName: deviceName,
        token: generateToken(),
        pairedAt: nowSec(),
      }
      addPairing(pairing)
    } else if (token) {
      pairing = findPairingByToken(token)
      if (!pairing || pairing.phoneId !== deviceId) {
        sendError(ws, "重连 token 无效，请重新配对")
        ws.close(4003)
        return
      }
    } else {
      sendError(ws, "手机端连接需提供配对码 code 或重连 token")
      ws.close(4003)
      return
    }
  }

  // 同设备重复连接：踢掉旧连接
  const connKey = keyOf(role!, deviceId)
  const old = connections.get(connKey)
  if (old) {
    try { old.ws.close(4000, "duplicate connection") } catch {}
  }

  const conn: Connection = { ws, role: role!, deviceId, name: deviceName, isAlive: true, token: pairing?.token ?? null }
  connections.set(connKey, conn)

  ws.on("pong", () => { conn.isAlive = true })

  if (role === "desktop") {
    handleDesktopConnect(conn)
  } else if (pairing) {
    handlePhoneConnect(conn, pairing)
  }

  ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    let msg: Record<string, JsonValue & Record<string, unknown>>
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      sendError(ws, "消息不是合法 JSON")
      return
    }
    if (typeof msg?.type !== "string") {
      sendError(ws, "消息缺少 type")
      return
    }
    handleMessage(conn, msg)
  })

  ws.on("close", () => handleDisconnect(conn))
  ws.on("error", () => { /* close 会兜底 */ })
})

function handleDesktopConnect(conn: Connection): void {
  const peers = listPairingsByDesktop(conn.deviceId).map((p) => ({
    deviceId: p.phoneId,
    name: p.phoneName,
    pairedAt: p.pairedAt,
    online: connections.has(keyOf("phone", p.phoneId)),
  }))
  send(conn.ws, "relay:hello", {
    role: "desktop",
    deviceId: conn.deviceId,
    name: conn.name,
    paired: peers as unknown as JsonValue,
  })
  // 若有待确认配对码，同步给桌面 UI
  const pending = getPendingByDesktop(conn.deviceId)
  if (pending) send(conn.ws, "relay:pairing-pending", { code: pending.code, expiresAt: pending.expiresAt })
  // 通知在线手机：桌面回来了
  for (const p of peers) {
    if (p.online) {
      const phone = getConnection("phone", p.deviceId)
      if (phone) send(phone.ws, "relay:peer-online", { deviceId: conn.deviceId, name: conn.name, role: "desktop" })
    }
  }
}

function handlePhoneConnect(conn: Connection, pairing: ConfirmedPairing): void {
  send(conn.ws, "relay:hello", {
    role: "phone",
    deviceId: conn.deviceId,
    name: conn.name,
    token: pairing.token,
    peer: { deviceId: pairing.desktopId, name: pairing.desktopName, role: "desktop" },
  })
  // 通知桌面（无论是否在线——在线才收得到）
  const desktop = getConnection("desktop", pairing.desktopId)
  if (desktop) {
    send(desktop.ws, "relay:paired", {
      deviceId: conn.deviceId,
      name: conn.name,
      pairedAt: pairing.pairedAt,
      isNewPairing: true,
    })
    send(conn.ws, "relay:peer-online", { deviceId: pairing.desktopId, name: pairing.desktopName, role: "desktop" })
  }
}

function handleDisconnect(conn: Connection): void {
  if (connections.get(keyOf(conn.role, conn.deviceId))?.ws !== conn.ws) return
  connections.delete(keyOf(conn.role, conn.deviceId))

  if (conn.role === "desktop") {
    for (const p of listPairingsByDesktop(conn.deviceId)) {
      const phone = getConnection("phone", p.phoneId)
      if (phone) send(phone.ws, "relay:peer-offline", { deviceId: conn.deviceId, role: "desktop" })
    }
  } else {
    const pairing = findPairingByPhone(conn.deviceId)
    if (pairing) {
      const desktop = getConnection("desktop", pairing.desktopId)
      if (desktop) send(desktop.ws, "relay:peer-offline", { deviceId: conn.deviceId, role: "phone" })
    }
  }
}

interface IncomingMsg {
  type: string
  id?: string | number
  timestamp?: number
  to?: string
  payload?: { targetDeviceId?: string; deviceId?: string; [k: string]: unknown }
  [k: string]: unknown
}

// ===== 消息处理 =====
function handleMessage(conn: Connection, rawMsg: Record<string, unknown>): void {
  const msg = rawMsg as IncomingMsg
  const type = msg.type

  // 系统消息
  if (type === "relay:ping") {
    send(conn.ws, "relay:pong", {}, msg.id !== undefined ? { id: msg.id as unknown as JsonValue } : {})
    return
  }
  if (type === "relay:unbind") {
    if (conn.role !== "desktop") {
      sendError(conn.ws, "只有桌面端可以解绑", msg.id)
      return
    }
    const phoneId = String(msg.payload?.deviceId ?? "")
    if (removePairing(conn.deviceId, phoneId)) {
      const phone = getConnection("phone", phoneId)
      if (phone) {
        send(phone.ws, "relay:unbound", { reason: "desktop_unpaired" })
        try { phone.ws.close(4000, "unpaired") } catch {}
      }
      send(conn.ws, "relay:unbound", { deviceId: phoneId }, msg.id !== undefined ? { id: msg.id as unknown as JsonValue } : {})
    } else {
      sendError(conn.ws, "配对关系不存在", msg.id)
    }
    return
  }
  if (type.startsWith("relay:")) {
    sendError(conn.ws, `未知系统消息: ${type}`, msg.id)
    return
  }

  // 业务消息：路由到对端
  const envelope = (): Record<string, unknown> => ({
    ...msg,
    sender: { deviceId: conn.deviceId, name: conn.name, role: conn.role },
    timestamp: msg.timestamp ?? nowSec(),
  })

  if (conn.role === "phone") {
    const pairing = findPairingByPhone(conn.deviceId)
    if (!pairing) {
      sendError(conn.ws, "配对关系已失效，请重新配对", msg.id)
      return
    }
    const desktop = getConnection("desktop", pairing.desktopId)
    if (!desktop) {
      sendError(conn.ws, "桌面端离线", msg.id)
      return
    }
    desktop.ws.send(JSON.stringify(envelope()))
    return
  }

  // desktop → phone（信封 to 或 payload.targetDeviceId 指定单播，否则广播给所有已配对手机）
  const targetId = String(msg.to ?? msg.payload?.targetDeviceId ?? "")
  const peers = listPairingsByDesktop(conn.deviceId)
  const targets = targetId ? peers.filter((p) => p.phoneId === targetId) : peers
  let delivered = 0
  for (const p of targets) {
    const phone = getConnection("phone", p.phoneId)
    if (phone) {
      phone.ws.send(JSON.stringify(envelope()))
      delivered++
    }
  }
  // 对带 id 的 RPC 请求，若对端全离线，明确告知（避免手机端等待超时）
  if (delivered === 0 && msg.id !== undefined) {
    sendError(conn.ws, targetId ? "目标手机离线" : "没有在线的已配对手机", msg.id)
  }
}

// ===== 心跳：30s ping，两次无 pong 判定断线 =====
const heartbeatTimer = setInterval(() => {
  for (const conn of connections.values()) {
    if (!conn.isAlive) {
      try { conn.ws.terminate() } catch {}
      continue
    }
    conn.isAlive = false
    try { conn.ws.ping() } catch {}
  }
}, HEARTBEAT_MS)
heartbeatTimer.unref?.()

server.listen(PORT, () => {
  console.log(`[nexa-relay] listening on http://0.0.0.0:${PORT} (WS path: /ws)`)
})
