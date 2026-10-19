/**
 * 浏览器插件中继 WS 客户端
 * 复用手机端配对流程（role=phone，deviceId=plugin-<uuid>），任意非 relay: 消息自动路由到已配对桌面端
 */

const PING_INTERVAL_MS = 25_000
const PONG_TIMEOUT_MS = 10_000
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000]

const STORAGE_KEYS = {
  token: "nexa.relay.token",
  url: "nexa.relay.url",
  deviceId: "nexa.plugin.deviceId",
} as const

type PeerInfo = { name?: string; deviceId?: string } | null

export type RelayStatus = {
  connected: boolean
  peerOnline: boolean
  peer: PeerInfo
  lastError: string | null
}

type RpcEntry = {
  resolve: (payload: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

async function load<T = unknown>(key: string): Promise<T | null> {
  const r = await chrome.storage.local.get(key)
  return (r[key] as T | undefined) ?? null
}

async function save(key: string, val: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: val })
}

async function remove(key: string): Promise<void> {
  await chrome.storage.local.remove(key)
}

export class RelayClient {
  private ws: WebSocket | null = null
  private shouldRun = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private rpcMap = new Map<string, RpcEntry>()
  private statusListeners = new Set<(s: RelayStatus) => void>()
  private opts:
    | { relayUrl: string; deviceId: string; name: string; code?: string; token?: string }
    | null = null

  status: RelayStatus = {
    connected: false,
    peerOnline: false,
    peer: null,
    lastError: null,
  }

  async getDeviceId(): Promise<string> {
    let id = await load<string>(STORAGE_KEYS.deviceId)
    if (!id) {
      id = `plugin-${crypto.randomUUID()}`
      await save(STORAGE_KEYS.deviceId, id)
    }
    return id
  }

  onStatus(fn: (s: RelayStatus) => void): () => boolean {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private emit(): void {
    for (const l of this.statusListeners) l(this.status)
  }

  /** 首次配对 */
  async pair(relayUrl: string, code: string): Promise<void> {
    await save(STORAGE_KEYS.url, relayUrl)
    await remove(STORAGE_KEYS.token)
    this.opts = {
      relayUrl,
      deviceId: await this.getDeviceId(),
      name: "Chrome 插件",
      code: code.toUpperCase(),
    }
    this.shouldRun = true
    this.reconnectAttempts = 0
    await this.connect()
  }

  /** 从存储恢复并重连 */
  async resume(): Promise<boolean> {
    const url = await load<string>(STORAGE_KEYS.url)
    const token = await load<string>(STORAGE_KEYS.token)
    if (!url) return false
    // 连接健康时直接返回，避免重复 teardown
    if (this.ws?.readyState === WebSocket.OPEN) return true
    this.opts = {
      relayUrl: url,
      deviceId: await this.getDeviceId(),
      name: "Chrome 插件",
      token: token ?? undefined,
    }
    this.shouldRun = true
    this.reconnectAttempts = 0
    await this.connect()
    return true
  }

  /**
   * 确保与中继的连接可用。
   * MV3 Service Worker 会休眠（WebSocket 随之断开），右键菜单点击唤醒后
   * status 可能仍是过期状态；发请求前必须先恢复连接并等待就绪。
   */
  async ensureConnected(maxWaitMs = 8_000): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return
    const resumed = await this.resume()
    if (!resumed) throw new Error("尚未配对，请打开插件完成配对设置")
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      if (this.ws?.readyState === WebSocket.OPEN) return
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error("连接中继超时，请打开插件检查配对状态")
  }

  async reconfigure(relayUrl: string): Promise<void> {
    await save(STORAGE_KEYS.url, relayUrl)
    if (!this.opts) return
    this.opts = { ...this.opts, relayUrl }
    this.teardown()
    this.clearReconnect()
    this.reconnectAttempts = 0
    if (this.shouldRun) await this.connect()
  }

  shutdown(): void {
    this.shouldRun = false
    this.teardown()
    this.clearReconnect()
    this.emit()
  }

  private buildUrl(): string {
    if (!this.opts) throw new Error("未配置中继")
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

  async connect(): Promise<void> {
    if (!this.opts?.relayUrl) return
    this.teardown()
    try {
      this.ws = new WebSocket(this.buildUrl())
    } catch (e) {
      this.status.lastError = e instanceof Error ? e.message : "连接失败"
      this.emit()
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.status.connected = true
      this.reconnectAttempts = 0
      this.status.lastError = null
      this.startHeartbeat()
      this.emit()
    }
    this.ws.onmessage = (ev: MessageEvent) => {
      let msg: { type: string; payload?: unknown; id?: string }
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      void this.handle(msg)
    }
    this.ws.onerror = () => {
      this.status.lastError = "连接错误"
    }
    this.ws.onclose = () => {
      this.status.connected = false
      this.status.peerOnline = false
      this.stopHeartbeat()
      this.emit()
      if (this.shouldRun) this.scheduleReconnect()
    }
  }

  private teardown(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        /* 忽略 */
      }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempts += 1
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

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.sendRaw("relay:ping", {})
      this.pongTimer = setTimeout(() => {
        try {
          this.ws?.close()
        } catch {
          /* 忽略 */
        }
      }, PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private async handle(msg: { type: string; payload?: any; id?: string }): Promise<void> {
    switch (msg.type) {
      case "relay:hello": {
        const p = (msg.payload || {}) as { token?: string; peer?: PeerInfo }
        if (p.token) {
          this.opts!.token = p.token
          await save(STORAGE_KEYS.token, p.token)
        }
        this.status.peer = p.peer || null
        this.status.peerOnline = !!p.peer
        this.emit()
        return
      }
      case "relay:paired":
        this.status.peer = msg.payload as PeerInfo
        this.status.peerOnline = true
        this.emit()
        return
      case "relay:peer-online":
        this.status.peerOnline = true
        if (msg.payload) this.status.peer = msg.payload as PeerInfo
        this.emit()
        return
      case "relay:peer-offline":
        this.status.peerOnline = false
        this.emit()
        return
      case "relay:unbound":
        await remove(STORAGE_KEYS.token)
        this.opts!.token = undefined
        this.status.peer = null
        this.status.peerOnline = false
        this.emit()
        return
      case "relay:pong":
        if (this.pongTimer) {
          clearTimeout(this.pongTimer)
          this.pongTimer = null
        }
        return
      default:
        break
    }
    if (msg.id) {
      const entry = this.rpcMap.get(msg.id)
      if (entry) {
        this.rpcMap.delete(msg.id)
        clearTimeout(entry.timer)
        if (msg.type === "relay:error") {
          entry.reject(new Error(msg.payload?.message || "中继错误"))
        } else {
          entry.resolve(msg.payload)
        }
      }
    }
  }

  private sendRaw(type: string, payload: unknown, extra: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type, timestamp: Math.floor(Date.now() / 1000), payload, ...extra }))
  }

  call<T = unknown>(type: string, payload: unknown, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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
}

export const relay = new RelayClient()
