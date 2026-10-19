/**
 * 手机端中继 WebSocket 客户端
 *
 * 协议与桌面端 / nexa-relay 严格一致：
 * - 连接 query: role=phone&deviceId=&name=&code= (首次) 或 &token= (重连)
 * - 信封 {type, id?, timestamp, payload?, to?, sender?}
 * - 心跳：客户端发 relay:ping，中继回 relay:pong
 */
import {
  type AgentEvent,
  type PairedPeer,
  type RelayEnvelope,
  AGENT_EVENT,
  RELAY_HELLO,
  RELAY_PAIRED,
  RELAY_PEER_OFFLINE,
  RELAY_PEER_ONLINE,
  RELAY_PING,
  RELAY_PONG,
  RELAY_UNBOUND,
  SCHEDULER_NOTIFY,
} from "./protocol"
import { storage } from "./storage"

const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000]
const PING_INTERVAL_MS = 25_000
const PONG_TIMEOUT_MS = 10_000

type RpcEntry = {
  resolve: (payload: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface RelayClientOptions {
  relayUrl: string
  deviceId: string
  name: string
  code?: string
  token?: string
}

export interface RelayStatus {
  connected: boolean
  peerOnline: boolean
  peer?: PairedPeer | null
  lastError: string | null
}

type StatusListener = (s: RelayStatus) => void
type EventListener = (event: AgentEvent) => void
type NotifyListener = (payload: unknown) => void

export class RelayClient {
  private ws: WebSocket | null = null
  private opts: RelayClientOptions
  private shouldRun = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private rpcMap = new Map<string, RpcEntry>()
  private statusListeners = new Set<StatusListener>()
  private eventListeners = new Set<EventListener>()
  private notifyListeners = new Set<NotifyListener>()

  public status: RelayStatus = {
    connected: false,
    peerOnline: false,
    peer: null,
    lastError: null,
  }

  constructor(opts: RelayClientOptions) {
    this.opts = opts
  }

  // ===== 生命周期 =====
  async start(): Promise<void> {
    this.shouldRun = true
    this.reconnectAttempts = 0
    await this.connect()
  }

  /** 更新连接参数（如换中继地址）后重连 */
  async reconfigure(opts: Partial<RelayClientOptions>): Promise<void> {
    this.opts = { ...this.opts, ...opts }
    this.teardownSocket()
    this.clearReconnect()
    this.reconnectAttempts = 0
    if (this.shouldRun) await this.connect()
  }

  shutdown(): void {
    this.shouldRun = false
    this.teardownSocket()
    this.clearReconnect()
    this.emitStatus()
  }

  // ===== 连接 =====
  private buildUrl(): string {
    const u = new URL(this.opts.relayUrl)
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:"
    const q = new URLSearchParams({
      role: "phone",
      deviceId: this.opts.deviceId,
      name: this.opts.name,
    })
    if (this.opts.token) q.set("token", this.opts.token)
    else if (this.opts.code) q.set("code", this.opts.code.toUpperCase())
    return `${wsProto}//${u.host}${u.pathname.replace(/\/$/, "")}/ws?${q.toString()}`
  }

  private async connect(): Promise<void> {
    if (!this.opts.relayUrl) return
    this.teardownSocket()
    const url = this.buildUrl()
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.status.lastError = e instanceof Error ? e.message : "连接失败"
      this.emitStatus()
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.status.connected = true
      this.reconnectAttempts = 0
      this.status.lastError = null
      this.startHeartbeat()
      this.emitStatus()
    }

    ws.onmessage = (ev) => {
      let msg: RelayEnvelope
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "")
      } catch {
        return
      }
      void this.handleMessage(msg)
    }

    ws.onerror = () => {
      this.status.lastError = "中继连接错误"
    }

    ws.onclose = () => {
      this.status.connected = false
      this.status.peerOnline = false
      this.stopHeartbeat()
      this.emitStatus()
      if (this.shouldRun) this.scheduleReconnect()
    }
  }

  private teardownSocket(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try { this.ws.close() } catch { /* noop */ }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldRun) void this.connect()
    }, delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ===== 心跳 =====
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.sendRaw(RELAY_PING, {})
      this.pongTimer = setTimeout(() => {
        // 10s 没收到 pong，认为连接已死
        try { this.ws?.close() } catch { /* noop */ }
      }, PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null }
  }

  // ===== 消息处理 =====
  private async handleMessage(msg: RelayEnvelope): Promise<void> {
    switch (msg.type) {
      case RELAY_HELLO: {
        const payload = (msg.payload ?? {}) as { token?: string; peer?: PairedPeer }
        if (payload.token) {
          this.opts.token = payload.token
          await storage.setToken(payload.token)
        }
        this.status.peer = payload.peer ?? null
        this.status.peerOnline = !!payload.peer
        this.emitStatus()
        return
      }
      case RELAY_PAIRED: {
        const peer = msg.payload as PairedPeer
        this.status.peer = peer
        this.status.peerOnline = true
        this.emitStatus()
        return
      }
      case RELAY_PEER_ONLINE:
        this.status.peerOnline = true
        if (msg.payload) this.status.peer = msg.payload as PairedPeer
        this.emitStatus()
        return
      case RELAY_PEER_OFFLINE:
        this.status.peerOnline = false
        this.emitStatus()
        return
      case RELAY_UNBOUND: {
        // 桌面端解绑：清空本地 token，回到配对页
        await storage.clearToken()
        this.opts.token = undefined
        this.status.peer = null
        this.status.peerOnline = false
        this.emitStatus()
        return
      }
      case RELAY_PONG:
        if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null }
        return
      case AGENT_EVENT:
        for (const l of this.eventListeners) l(msg.payload as AgentEvent)
        return
      case SCHEDULER_NOTIFY:
        for (const l of this.notifyListeners) l(msg.payload)
        return
      default:
        break
    }

    // RPC 回包：按 id 匹配
    if (msg.id) {
      const entry = this.rpcMap.get(msg.id)
      if (entry) {
        this.rpcMap.delete(msg.id)
        clearTimeout(entry.timer)
        if (msg.type === "relay:error") {
          entry.reject(new Error((msg.payload as { message?: string })?.message ?? "中继错误"))
        } else {
          entry.resolve(msg.payload)
        }
      }
    }
  }

  // ===== 发送 =====
  private sendRaw(type: string, payload: unknown, extra: Partial<RelayEnvelope> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const env: RelayEnvelope = { type, timestamp: Math.floor(Date.now() / 1000), payload, ...extra }
    this.ws.send(JSON.stringify(env))
  }

  /** 发起一个带 id 的 RPC，等待回包 */
  call<P = unknown>(type: string, payload?: unknown, timeoutMs = 30_000): Promise<P> {
    return new Promise<P>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("未连接中继"))
        return
      }
      const id = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const timer = setTimeout(() => {
        this.rpcMap.delete(id)
        reject(new Error("请求超时"))
      }, timeoutMs)
      this.rpcMap.set(id, { resolve: resolve as (p: unknown) => void, reject, timer })
      this.sendRaw(type, payload, { id })
    })
  }

  // ===== 订阅 =====
  onStatus(l: StatusListener): () => void { this.statusListeners.add(l); return () => this.statusListeners.delete(l) }
  onAgentEvent(l: EventListener): () => void { this.eventListeners.add(l); return () => this.eventListeners.delete(l) }
  onSchedulerNotify(l: NotifyListener): () => void { this.notifyListeners.add(l); return () => this.notifyListeners.delete(l) }

  private emitStatus(): void {
    for (const l of this.statusListeners) l(this.status)
  }
}
