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

  /** 当前使用的 token（配对成功后由 hello 下发并保存） */
  get token(): string | undefined {
    return this.opts.token
  }

  /** 当前中继地址 */
  get relayUrl(): string {
    return this.opts.relayUrl
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
    // 调试日志：连接尝试在 Metro 终端 / adb logcat -s ReactNativeJS 可见
    console.log(`[relay] connect → ${url}`)
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      console.log("[relay] ws create failed:", e)
      this.status.lastError = e instanceof Error ? e.message : "连接失败"
      this.emitStatus()
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      console.log("[relay] open")
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
      console.log("[relay] ←", msg.type, msg.id ?? "")
      void this.handleMessage(msg)
    }

    ws.onerror = (ev) => {
      // RN 的错误事件仅 message 字段可能有值；HTTP 升级失败（404/网络不通）通常表现为 onerror + onclose
      const detail = (ev as unknown as { message?: string })?.message ?? ""
      console.log("[relay] error:", detail || "(无详情)")
      this.status.lastError = detail ? `中继连接错误：${detail}` : "中继连接错误"
      this.emitStatus()
    }

    ws.onclose = (ev) => {
      const { code: closeCode, reason } = (ev as unknown as { code?: number; reason?: string }) ?? {}
      console.log(`[relay] close code=${closeCode} reason=${reason || "(空)"}`)
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
        // 先同步置位 peer/peerOnline 并广播，再异步持久化 token——
        // 若先 await 落盘，期间被中继踢连（onclose 清 peerOnline）会把配对成功状态抹掉
        this.status.peer = payload.peer ?? null
        this.status.peerOnline = !!payload.peer
        this.emitStatus()
        if (payload.token) {
          this.opts.token = payload.token
          try {
            await storage.setToken(payload.token)
          } catch (e) {
            console.log("[relay] save token failed:", e)
          }
        }
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
      case "relay:error": {
        // 无 RPC id 的中继错误（如配对码无效）：透传到状态栏，供配对页/用户感知
        const message = (msg.payload as { message?: string } | undefined)?.message ?? "中继错误"
        console.log("[relay] server error:", message)
        this.status.lastError = message
        this.emitStatus()
        return
      }
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

  /** 发起一个带 id 的 RPC，等待回包（桌面端正常响应在毫秒级，12s 足够覆盖慢网；无响应不必干等 30s） */
  call<P = unknown>(type: string, payload?: unknown, timeoutMs = 12_000): Promise<P> {
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
    // 必须快照：this.status 是被原地修改的单例对象，直接传引用会让
    // zustand/React 认为状态没变（Object.is 相等），界面永远不更新
    const snapshot = { ...this.status }
    for (const l of this.statusListeners) l(snapshot)
  }
}
