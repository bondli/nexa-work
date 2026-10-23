/**
 * 桌面端中继客户端 (M5b)
 *
 * - 以 desktop 角色与 nexa-relay 保持 WebSocket 长连：自动重连（指数退避）+ ping 心跳
 * - 配对：REST 申请 6 位码；relay:paired 到达即配对成功（手机端带码连入）
 * - 手机端 RPC 分发到本地能力（建任务/续跑/查询会话）
 * - 桌面端 Agent 事件 / 定时任务通知广播到全部已配对手机
 *
 * 不直接依赖 agentRuntime / db —— 由 main/index.ts 注入 services，避免循环依赖
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import WebSocket from "ws"
import type { AgentEvent, AttachmentInput, PairedDevice, PendingPairing, RelayStatus } from "@shared/ipc-channels"
import { getDeviceIdentity } from "./device"

/** 手机端 / 浏览器插件可调用的本地能力（由 main/index.ts 实现） */
export interface RelayServices {
  createTask(prompt: string, model?: string, attachments?: AttachmentInput[]): Promise<{ sessionId: string; title: string; mode: string }>
  /** attachments：手机端随消息发送的图片附件（dataUrl，主进程落盘 ~/.nexa/uploads 后注入会话） */
  sendMessage(sessionId: string, message: string, attachments?: AttachmentInput[]): Promise<boolean>
  pauseSession(sessionId: string): Promise<boolean>
  resumeSession(sessionId: string): Promise<boolean>
  listSessions(): Promise<unknown>
  listMessages(sessionId: string): Promise<unknown>
  /** 任务产物列表（自由任务 workspace 下的 md/html 文档） */
  sessionArtifacts(sessionId: string): Promise<unknown>
  /** 产物内容读取（手机端预览） */
  artifactRead(sessionId: string, relPath: string): Promise<unknown>
  /** 任务轨迹列表（agent_runs，供手机端展示「任务耗时」） */
  sessionRuns(sessionId: string): Promise<unknown>
  // 浏览器插件（M6）
  ingestArticle(input: { url: string; html?: string; text?: string; title?: string }): Promise<{ ok: boolean; id?: string; title?: string; duplicate?: boolean }>
  favoriteImage(input: { url: string; data: string; mimeType?: string; title?: string; description?: string }): Promise<{ ok: boolean; id?: string }>
  searchLibrary(query: string): Promise<Array<{ id: string; title: string; summary?: string; type: string }>>
  // 笔记管理（浏览器插件笔记页）
  noteList(params?: { category?: string; search?: string }): Promise<unknown>
  noteGet(id: string): Promise<unknown>
  noteCreate(params: { title: string; content?: string; category?: string }): Promise<unknown>
  noteUpdate(id: string, patch: { title?: string; content?: string; category?: string }): Promise<unknown>
  noteDelete(id: string): Promise<{ ok: boolean }>
  noteCategories(): Promise<unknown>
  // 手机端资料页 / 定时任务页
  scheduleList(): Promise<unknown>
  scheduleRuns(jobId: string, limit?: number): Promise<unknown>
  libraryList(): Promise<unknown>
  libraryGet(id: string): Promise<unknown>
}

/** 中继消息信封 */
interface RelayEnvelope {
  type: string
  id?: string
  timestamp?: number
  to?: string
  payload?: any
  sender?: { deviceId: string; name: string; role: string }
}

const STATE_FILE = join(homedir(), ".nexa", "relay-state.json")
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000]
const PING_INTERVAL_MS = 25_000

export class RelayClient {
  private ws: WebSocket | null = null
  private connected = false
  private shouldRun = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimeout: ReturnType<typeof setTimeout> | null = null

  private relayUrl = ""
  private paired = new Map<string, PairedDevice>()
  /** 本机自定义的设备名（deviceId → 别名）；中继只保存手机上报的名字，改名只在本机生效 */
  private aliases = new Map<string, string>()
  private pendingPairing: PendingPairing | null = null
  private lastError: string | null = null
  private pendingPairingTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(
    private services: RelayServices,
    private onStatusChange: (status: RelayStatus) => void,
  ) {
    this.loadPairedCache()
  }

  /** 应用启动时调用：settings 有 relayUrl 则自动连接 */
  start(relayUrl: string): void {
    this.relayUrl = relayUrl.trim()
    if (this.relayUrl) this.connect()
  }

  /** 设置页保存中继地址：空串=断开并停用 */
  configure(relayUrl: string): void {
    const url = relayUrl.trim()
    this.relayUrl = url
    this.teardownSocket()
    this.clearReconnect()
    this.connected = false
    this.lastError = null
    if (url) {
      this.shouldRun = true
      this.reconnectAttempts = 0
      this.connect()
    } else {
      this.shouldRun = false
    }
    this.emit()
  }

  shutdown(): void {
    this.destroyed = true
    this.shouldRun = false
    this.teardownSocket()
    this.clearReconnect()
    if (this.pendingPairingTimer) {
      clearTimeout(this.pendingPairingTimer)
      this.pendingPairingTimer = null
    }
    this.connected = false
  }

  getStatus(): RelayStatus {
    const identity = getDeviceIdentity()
    return {
      connected: this.connected,
      deviceId: identity.deviceId,
      deviceName: identity.name,
      relayUrl: this.relayUrl,
      pendingPairing: this.pendingPairing,
      paired: [...this.paired.values()].sort((a, b) => b.pairedAt - a.pairedAt),
      lastError: this.lastError,
    }
  }

  /** REST 申请配对码 */
  async requestPairing(): Promise<{ code: string; expiresAt: number }> {
    if (!this.relayUrl) throw new Error("尚未配置中继服务器地址")
    const identity = getDeviceIdentity()
    let res: Response
    try {
      res = await fetch(`${this.relayUrl.replace(/\/$/, "")}/api/pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: identity.deviceId, deviceName: identity.name }),
      })
    } catch {
      throw new Error("无法连接中继服务器，请检查地址")
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `申请失败 (${res.status})`)
    }
    const data = (await res.json()) as { code: string; expiresAt: number }
    // 若 WS 当前不在线（REST 可达但 WS 断了），本地也先记录待确认状态
    this.setPendingPairing({ code: data.code, expiresAt: data.expiresAt })
    return data
  }

  /** 解绑手机 */
  async unbind(deviceId: string): Promise<void> {
    this.paired.delete(deviceId)
    this.aliases.delete(deviceId)
    this.savePairedCache()
    if (this.connected) {
      this.send("relay:unbind", { deviceId })
    }
    this.emit()
  }

  /**
   * 重命名已配对设备
   * 别名只落本机 relay-state.json：中继的配对记录由手机上报名字，桌面端没有改写权限，
   * 所以每次收到 relay:hello / relay:paired 都再用别名覆盖一次，避免被服务端名字冲掉。
   */
  rename(deviceId: string, name: string): void {
    const next = (name ?? "").trim().slice(0, 32)
    if (!next) throw new Error("设备名称不能为空")
    const d = this.paired.get(deviceId)
    if (!d) throw new Error("设备不存在或已解绑")
    d.name = next
    this.aliases.set(deviceId, next)
    this.savePairedCache()
    this.emit()
  }

  /** 广播 Agent 事件到全部已配对在线手机 */
  forwardAgentEvent(event: AgentEvent): void {
    if (!this.connected) return
    // delta 事件量极大，手机端流式体验需要，保留转发；其余事件全量
    this.send("agent:event", event)
  }

  /** 广播定时任务执行结果（手机推送） */
  forwardSchedulerNotify(payload: { success: boolean; description: string; output: string }): void {
    if (!this.connected) return
    this.send("scheduler:notify", { ...payload, ts: Math.floor(Date.now() / 1000) })
  }

  // ===== 连接管理 =====

  private httpToWsUrl(): string {
    const u = new URL(this.relayUrl)
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:"
    const identity = getDeviceIdentity()
    const q = new URLSearchParams({
      role: "desktop",
      deviceId: identity.deviceId,
      name: identity.name,
    })
    return `${wsProto}//${u.host}${u.pathname.replace(/\/$/, "")}/ws?${q.toString()}`
  }

  private connect(): void {
    if (!this.relayUrl) return
    this.shouldRun = true
    let url: string
    try {
      url = this.httpToWsUrl()
    } catch {
      this.lastError = "中继地址格式无效"
      this.emit()
      return
    }

    const ws = new WebSocket(url, { handshakeTimeout: 10_000 })
    this.ws = ws

    ws.on("open", () => {
      this.connected = true
      this.reconnectAttempts = 0
      this.lastError = null
      this.startHeartbeat()
      this.emit()
    })

    ws.on("message", (raw) => {
      let msg: RelayEnvelope
      try {
        msg = JSON.parse(raw.toString()) as RelayEnvelope
      } catch {
        return
      }
      this.handleMessage(msg).catch(() => {})
    })

    // 协议级 ping 对应的 pong 帧（心跳超时判定以此为准）
    ws.on("pong", () => {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout)
        this.pongTimeout = null
      }
    })

    ws.on("close", () => {
      this.connected = false
      this.stopHeartbeat()
      // 所有手机随断线标记离线（hello 重连后会纠正）
      for (const d of this.paired.values()) d.online = false
      this.emit()
      if (this.shouldRun && this.relayUrl) this.scheduleReconnect()
    })

    ws.on("error", () => {
      // close 事件会紧随其后，重连逻辑统一在 close 处理
      this.lastError = "中继连接失败"
    })
  }

  private teardownSocket(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.removeAllListeners()
      try { this.ws.close() } catch {}
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldRun && this.relayUrl) this.connect()
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.ws.ping()
      // 10s 内没收到 pong（ws 库自动响应）则认为断线
      this.pongTimeout = setTimeout(() => {
        try { this.ws?.terminate() } catch {}
      }, 10_000)
    }, PING_INTERVAL_MS)
    this.pingTimer.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout)
      this.pongTimeout = null
    }
  }

  // ===== 消息处理 =====

  private async handleMessage(msg: RelayEnvelope): Promise<void> {
    switch (msg.type) {
      case "relay:hello": {
        const list = (msg.payload?.paired ?? []) as PairedDevice[]
        // 服务端下发的是手机上报的名字，本机改过名的要用别名覆盖
        this.paired = new Map(list.map((d) => [d.deviceId, this.applyAlias(d)]))
        this.savePairedCache()
        this.emit()
        return
      }
      case "relay:paired": {
        const d = this.applyAlias(msg.payload as PairedDevice)
        this.paired.set(d.deviceId, { ...d, online: true })
        this.savePairedCache()
        this.emit()
        return
      }
      case "relay:pairing-pending": {
        this.setPendingPairing({ code: msg.payload.code, expiresAt: msg.payload.expiresAt })
        return
      }
      case "relay:peer-online": {
        const d = this.paired.get(msg.payload.deviceId)
        if (d) {
          d.online = true
          this.emit()
        }
        return
      }
      case "relay:peer-offline": {
        const d = this.paired.get(msg.payload.deviceId)
        if (d) {
          d.online = false
          this.emit()
        }
        return
      }
      case "relay:unbound": {
        if (msg.payload?.deviceId) {
          this.paired.delete(msg.payload.deviceId)
          this.aliases.delete(msg.payload.deviceId)
          this.savePairedCache()
          this.emit()
        }
        return
      }
      case "relay:pong":
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout)
          this.pongTimeout = null
        }
        return
      case "relay:error": {
        // 对端离线等 RPC 类错误只记录，不打扰 UI 主流程
        this.lastError = msg.payload?.message ?? "中继错误"
        this.emit()
        return
      }
      default:
        break
    }

    // 业务 RPC（手机 → 桌面）
    if (msg.type.startsWith("relay:")) return
    await this.dispatchFromPhone(msg)
  }

  private async dispatchFromPhone(msg: RelayEnvelope): Promise<void> {
    const senderId = msg.sender?.deviceId
    const reply = (payload: unknown) => this.reply(msg, payload)
    const replyError = (message: string) => this.replyError(msg, message)
    /** 手机端图片附件归一化：仅保留带 dataUrl 的项，最多 3 张（中继 4MB 上限） */
    const normalizeAttachments = (raw: unknown): AttachmentInput[] =>
      Array.isArray(raw)
        ? raw
            .filter((a: unknown) => a && typeof (a as AttachmentInput).dataUrl === "string")
            .slice(0, 3)
            .map((a: AttachmentInput) => ({
              name: String(a.name ?? "image.jpg"),
              mimeType: String(a.mimeType ?? "image/jpeg"),
              dataUrl: a.dataUrl,
            }))
        : []

    try {
      switch (msg.type) {
        case "task:create": {
          const prompt = String(msg.payload?.prompt ?? "").trim()
          if (!prompt) throw new Error("prompt 必填")
          const model = msg.payload?.model ? String(msg.payload.model) : undefined
          const result = await this.services.createTask(prompt, model, normalizeAttachments(msg.payload?.attachments))
          await reply(result)
          return
        }
        case "session:send": {
          const { sessionId, message, attachments } = msg.payload ?? {}
          // 允许仅带图片附件的空文本消息（与桌面端粘贴图片直接发送对齐）
          if (!sessionId || (!message && !(Array.isArray(attachments) && attachments.length > 0))) throw new Error("sessionId / message 必填")
          const ok = await this.services.sendMessage(String(sessionId), String(message ?? ""), normalizeAttachments(attachments))
          await reply({ ok })
          return
        }
        case "session:pause": {
          const ok = await this.services.pauseSession(String(msg.payload?.sessionId ?? ""))
          await reply({ ok })
          return
        }
        case "session:resume": {
          const ok = await this.services.resumeSession(String(msg.payload?.sessionId ?? ""))
          await reply({ ok })
          return
        }
        case "session:list": {
          await reply(await this.services.listSessions())
          return
        }
        case "session:messages": {
          await reply(await this.services.listMessages(String(msg.payload?.sessionId ?? "")))
          return
        }
        case "session.artifacts": {
          const sessionId = String(msg.payload?.sessionId ?? "")
          if (!sessionId) throw new Error("sessionId 必填")
          await reply(await this.services.sessionArtifacts(sessionId))
          return
        }
        case "artifact.read": {
          const sessionId = String(msg.payload?.sessionId ?? "")
          const relPath = String(msg.payload?.path ?? "")
          if (!sessionId || !relPath) throw new Error("sessionId / path 必填")
          await reply(await this.services.artifactRead(sessionId, relPath))
          return
        }
        case "session.runs": {
          const sessionId = String(msg.payload?.sessionId ?? "")
          if (!sessionId) throw new Error("sessionId 必填")
          await reply(await this.services.sessionRuns(sessionId))
          return
        }
        case "library:ingest-article": {
          const { url, html, text, title } = msg.payload ?? {}
          if (!url) throw new Error("url 必填")
          console.log(`[relay] library:ingest-article 收到: url=${String(url).slice(0, 80)} textLen=${text ? String(text).length : 0} htmlLen=${html ? String(html).length : 0}`)
          const r = await this.services.ingestArticle({ url: String(url), html: html ? String(html) : undefined, text: text ? String(text) : undefined, title: title ? String(title) : undefined })
          console.log(`[relay] library:ingest-article 完成: ${r.duplicate ? "重复跳过" : r.ok ? "入库成功" : "未知状态"}`)
          await reply(r)
          return
        }
        case "library:favorite-image": {
          const { url, data, mimeType, title, description } = msg.payload ?? {}
          if (!url || !data) throw new Error("url / data 必填")
          console.log(`[relay] library:favorite-image 收到: url=${String(url).slice(0, 80)} size=${data.length}`)
          const r = await this.services.favoriteImage({ url: String(url), data: String(data), mimeType: mimeType ? String(mimeType) : undefined, title: title ? String(title) : undefined, description: description ? String(description) : undefined })
          console.log(`[relay] library:favorite-image 完成: ${r.ok ? "入库成功" : "失败"}`)
          await reply(r)
          return
        }
        case "library:search": {
          const query = String(msg.payload?.query ?? "").trim()
          if (!query) throw new Error("query 必填")
          await reply(await this.services.searchLibrary(query))
          return
        }
        case "note.list": {
          const params = msg.payload as { category?: string; search?: string } | undefined
          await reply(await this.services.noteList(params))
          return
        }
        case "note.get": {
          const id = String(msg.payload?.id ?? "")
          if (!id) throw new Error("id 必填")
          await reply(await this.services.noteGet(id))
          return
        }
        case "note.create": {
          const { title, content, category } = msg.payload ?? {}
          if (!title || typeof title !== "string") throw new Error("title 必填")
          await reply(await this.services.noteCreate({ title, content: content ? String(content) : undefined, category: category ? String(category) : undefined }))
          return
        }
        case "note.update": {
          const { id, patch } = msg.payload ?? {}
          if (!id) throw new Error("id 必填")
          await reply(await this.services.noteUpdate(String(id), patch ?? {}))
          return
        }
        case "note.delete": {
          const id = String(msg.payload?.id ?? "")
          if (!id) throw new Error("id 必填")
          await reply(await this.services.noteDelete(id))
          return
        }
        case "note.categories": {
          await reply(await this.services.noteCategories())
          return
        }
        case "schedule.list": {
          await reply(await this.services.scheduleList())
          return
        }
        case "schedule.runs": {
          const jobId = String(msg.payload?.jobId ?? "")
          if (!jobId) throw new Error("jobId 必填")
          await reply(await this.services.scheduleRuns(jobId))
          return
        }
        case "library.list": {
          await reply(await this.services.libraryList())
          return
        }
        case "library.item": {
          const id = String(msg.payload?.id ?? "")
          if (!id) throw new Error("id 必填")
          await reply(await this.services.libraryGet(id))
          return
        }
        default: {
          // 未知消息类型：立即回错，避免手机端干等 RPC 超时
          await replyError(`桌面端不支持的消息类型: ${msg.type}`)
          return
        }
      }
    } catch (err) {
      await replyError(err instanceof Error ? err.message : String(err))
    } finally {
      // senderId 仅用于标记活跃，不做额外处理（保留给未来"最近活跃设备"）
      void senderId
    }
  }

  // ===== 发送 =====

  private send(type: string, payload: unknown, extra: Partial<RelayEnvelope> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const envelope: RelayEnvelope = {
      type,
      timestamp: Math.floor(Date.now() / 1000),
      payload,
      ...extra,
    }
    this.ws.send(JSON.stringify(envelope))
  }

  private reply(request: RelayEnvelope, payload: unknown): void {
    if (!request.id) return
    this.send(request.type, payload, { id: request.id, to: request.sender?.deviceId })
  }

  private replyError(request: RelayEnvelope, message: string): void {
    if (!request.id) return
    this.send("relay:error", { message, refType: request.type }, { id: request.id, to: request.sender?.deviceId })
  }

  // ===== 状态 & 持久化 =====

  private setPendingPairing(p: PendingPairing): void {
    this.pendingPairing = p
    if (this.pendingPairingTimer) clearTimeout(this.pendingPairingTimer)
    this.pendingPairingTimer = setTimeout(() => {
      this.pendingPairing = null
      this.emit()
    }, Math.max(0, p.expiresAt - Date.now()))
    this.emit()
  }

  private emit(): void {
    if (this.destroyed) return
    this.onStatusChange(this.getStatus())
  }

  /** 若本机给该设备改过名，用别名覆盖服务端下发的名字 */
  private applyAlias(d: PairedDevice): PairedDevice {
    const alias = this.aliases.get(d.deviceId)
    return alias ? { ...d, name: alias } : d
  }

  private loadPairedCache(): void {
    try {
      if (existsSync(STATE_FILE)) {
        const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
          paired?: PairedDevice[]
          /** 本机自定义设备名（新增字段，旧缓存没有则视为空） */
          renames?: Record<string, string>
        }
        for (const [deviceId, name] of Object.entries(raw.renames ?? {})) {
          if (deviceId && typeof name === "string" && name.trim()) this.aliases.set(deviceId, name)
        }
        for (const d of raw.paired ?? []) {
          if (d?.deviceId) this.paired.set(d.deviceId, { ...this.applyAlias(d), online: false })
        }
      }
    } catch {
      /* 缓存损坏忽略 */
    }
  }

  private savePairedCache(): void {
    try {
      const dir = join(homedir(), ".nexa")
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data = {
        paired: [...this.paired.values()].map(({ deviceId, name, pairedAt }) => ({ deviceId, name, pairedAt })),
        renames: Object.fromEntries(this.aliases),
      }
      writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
    } catch {
      /* 缓存写失败忽略 */
    }
  }
}
