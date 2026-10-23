/**
 * 中继客户端单例 + Zustand 状态
 */
import { create } from "zustand"
import { Alert, AppState } from "react-native"
import { RelayClient, type RelayStatus } from "./client"
import type {
  AgentEvent,
  AgentRunSummary,
  ArtifactItem,
  ChatMessage,
  ImageAttachmentInput,
  JobRunSummary,
  LibraryItemSummary,
  LibrarySearchResult,
  ScheduledJobSummary,
  SessionSummary,
} from "./protocol"
import { getDeviceIdentity, storage, type RelayPairing } from "./storage"
import { playNoticeSound } from "../notice-sound"
import {
  cancelPendingNotifications,
  ensureNotificationPermission,
  hasNotificationPermission,
  openNotificationSettings as openSystemNotificationSettings,
  pushAvailable,
  showTaskNotification,
} from "../push"
import {
  LIBRARY_ITEM,
  LIBRARY_LIST,
  LIBRARY_SEARCH,
  SCHEDULE_LIST,
  SCHEDULE_RUNS,
  SESSION_LIST,
  SESSION_MESSAGES,
  SESSION_SEND,
  TASK_CREATE,
} from "./protocol"

/** 一轮任务的轨迹元数据（来自 run.started / run.finished 事件） */
export interface RunMeta {
  startedAt: number
  status: "running" | "completed" | "failed" | "paused"
  /** 结束后由桌面端给出的实际耗时（毫秒） */
  durationMs: number | null
  toolCallCount: number
}

let client: RelayClient | null = null

/**
 * 资料条目短期缓存：图片条目从桌面端下发的是完整 base64，重复查看会反复走中继。
 * 只缓存最近几条（含大图时内存占用可控），列表刷新不影响缓存命中。
 */
const LIBRARY_ITEM_CACHE_MAX = 6
const libraryItemCache = new Map<string, LibraryItemSummary>()

function readLibraryItemCache(id: string): LibraryItemSummary | undefined {
  const hit = libraryItemCache.get(id)
  if (hit) {
    // 命中后移到队尾，保持「最近使用」顺序
    libraryItemCache.delete(id)
    libraryItemCache.set(id, hit)
  }
  return hit
}

function writeLibraryItemCache(id: string, item: LibraryItemSummary): void {
  libraryItemCache.set(id, item)
  while (libraryItemCache.size > LIBRARY_ITEM_CACHE_MAX) {
    const oldest = libraryItemCache.keys().next().value
    if (oldest == null) break
    libraryItemCache.delete(oldest)
  }
}

/** 统一接线：状态/事件 → store */
function wireClient(c: RelayClient): void {
  c.onStatus((s) => useRelayStore.getState().setStatus(s))
  c.onAgentEvent((e) => useRelayStore.getState().handleAgentEvent(e))
}

export async function initRelayService(): Promise<void> {
  if (client) return
  const identity = await getDeviceIdentity()
  // 多电脑配对：优先取当前选中的电脑的 token/地址；否则回退旧的单 token（兼容升级前的用户）
  const pairings = await storage.getPairings()
  const currentId = await storage.getCurrentDesktopId()
  const cur = pairings.find((p) => p.desktopId === currentId) ?? null
  const relayUrl = cur?.relayUrl ?? (await storage.getRelayUrl()) ?? ""
  const token = cur?.token ?? (await storage.getToken()) ?? undefined
  client = new RelayClient({
    relayUrl,
    deviceId: identity.deviceId,
    name: identity.name,
    token,
  })
  wireClient(client)
  // 恢复通知开关与提示音设置；开关已开则顺带确保系统通知权限（首次会弹系统授权框）
  void storage.getNotifyEnabled().then((v) => {
    useRelayStore.setState({ notifyEnabled: v })
    if (v) void ensureNotificationPermission()
    void useRelayStore.getState().refreshNotifyPermission()
  })
  // 回到前台时校准系统通知权限（用户可能在系统设置里关掉了通知）
  AppState.addEventListener("change", (state) => {
    if (state === "active") void useRelayStore.getState().refreshNotifyPermission()
  })
  void storage.getNoticeSound().then((v) => useRelayStore.setState({ noticeSound: v }))
  useRelayStore.setState({ pairings, currentDesktopId: cur?.desktopId ?? null })
  // 兼容升级：老配对用户只有单 token、pairings 为空 → 首次握手成功后自动补一条配对记录
  if (!cur && token && relayUrl) {
    const unsubOnce = client.onStatus((s) => {
      if (s.peerOnline && s.peer) {
        unsubOnce()
        void useRelayStore.getState().commitPairing()
      }
    })
  }
  // 只有已配对（有 token）才自动重连；无 token 启动会一直空连被中继拒，
  // 且与配对流程的连接同 deviceId 冲突（互踢），导致配对永远不成功
  if (relayUrl && token) void client.start()
}

export function getRelayClient(): RelayClient | null {
  return client
}

/** 由配对页在首次配对成功后调用，注入 token 并启动 */
export async function startRelayWithPairing(relayUrl: string, code: string): Promise<void> {
  // 关停旧客户端（含热更新/重启后遗留的实例）——同 deviceId 双连接会被中继互踢，
  // 配对连接建立几毫秒内就被顶掉，导致"云端已配对、手机一直转圈"
  if (client) {
    client.shutdown()
    client = null
  }
  const identity = await getDeviceIdentity()
  await storage.setRelayUrl(relayUrl)
  client = new RelayClient({
    relayUrl,
    deviceId: identity.deviceId,
    name: identity.name,
    code,
  })
  wireClient(client)
  await client.start()
  // start() 只是创建 WebSocket 即返回；真正配对成功以 relay 下发 paired/hello（peerOnline=true）为准。
  // 这里等待结果，15s 超时判定失败并关停客户端，避免配对页永远转圈。
  await new Promise<void>((resolve, reject) => {
    const c = client!
    const timer = setTimeout(() => {
      unsub()
      c.shutdown()
      client = null
      const hint = useRelayStore.getState().status.lastError
      const tip = hint ? `；${hint}` : "；检查地址/网络/配对码（模拟器内请用 10.0.2.2 代替 127.0.0.1）"
      reject(new Error(`配对超时${tip}`))
    }, 15_000)
    const unsub = c.onStatus((s) => {
      if (s.peerOnline) {
        clearTimeout(timer)
        unsub()
        resolve()
      }
    })
  })
  // 配对成功：保存/更新配对记录并设为当前电脑
  await useRelayStore.getState().commitPairing()
}

export async function reconfigureRelay(relayUrl: string): Promise<void> {
  if (!client) {
    const identity = await getDeviceIdentity()
    client = new RelayClient({ relayUrl, deviceId: identity.deviceId, name: identity.name })
    client.onStatus((s) => useRelayStore.getState().setStatus(s))
    client.onAgentEvent((e) => useRelayStore.getState().handleAgentEvent(e))
    await client.start()
  } else {
    await storage.setRelayUrl(relayUrl)
    await client.reconfigure({ relayUrl })
  }
}

/** 解绑当前电脑并清空连接（跳配对页前调用） */
export async function unbindAndReset(): Promise<void> {
  if (client) client.shutdown()
  client = null
  await storage.clearToken()
  useRelayStore.setState({
    status: { connected: false, peerOnline: false, peer: null, lastError: null },
    sessions: [],
    messages: {},
  })
}

interface RelayStoreState {
  status: RelayStatus
  sessions: SessionSummary[]
  messages: Record<string, ChatMessage[]>
  loadingSessions: boolean
  loadingMessages: Record<string, boolean>
  /** 定时任务 / 资料库 */
  jobs: ScheduledJobSummary[]
  loadingJobs: boolean
  jobRuns: Record<string, JobRunSummary[]>
  /** 任务产物（按 sessionId 缓存，任务详情页产物卡使用） */
  artifacts: Record<string, ArtifactItem[]>
  /** 最近一轮任务轨迹元数据（会话详情页「任务耗时」摘要条） */
  runMeta: Record<string, RunMeta>
  /** 历史任务轨迹（按 sessionId → runId 索引，来自 session.runs） */
  historicRuns: Record<string, Record<string, RunMeta>>
  libraryItems: LibraryItemSummary[]
  notes: LibraryItemSummary[]
  loadingLibrary: boolean
  /** 定时任务/资料加载失败提示（如桌面端版本过旧） */
  scheduleError: string | null
  libraryError: string | null
  /** 通知开关（定时任务完成/失败提醒） */
  notifyEnabled: boolean
  /** 系统通知权限是否已授予（与系统设置联动） */
  notifyPermission: boolean
  /** 通知提示音（灵动/清脆/悠扬/静音，与桌面端同组音色） */
  noticeSound: string
  /** 多电脑配对：全部配对记录 + 当前选中的 desktopId */
  pairings: RelayPairing[]
  currentDesktopId: string | null
  setStatus: (s: RelayStatus) => void
  loadSessions: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  /** 加载任务产物列表（任务详情页产物卡） */
  loadArtifacts: (sessionId: string) => Promise<void>
  /** 读取产物内容（md/html 文本） */
  readArtifact: (sessionId: string, relPath: string) => Promise<{ path: string; content: string | null; size: number } | null>
  createTask: (prompt: string, model?: string, attachments?: ImageAttachmentInput[]) => Promise<{ sessionId: string }>
  sendMessage: (sessionId: string, message: string, attachments?: ImageAttachmentInput[]) => Promise<boolean>
  searchLibrary: (query: string) => Promise<LibrarySearchResult[]>
  loadJobs: () => Promise<void>
  loadJobRuns: (jobId: string) => Promise<void>
  loadLibrary: () => Promise<void>
  loadLibraryItem: (id: string) => Promise<LibraryItemSummary | null>
  /** 新增纯笔记（note 表，与桌面端笔记同源） */
  createNote: (params: { title: string; content?: string }) => Promise<unknown>
  setNotifyEnabled: (v: boolean) => Promise<void>
  /** 重新读取系统通知权限；权限被系统关闭时自动把 App 内开关置为关闭 */
  refreshNotifyPermission: () => Promise<void>
  /** 打开系统通知设置页（权限被拒时引导用户手动开启） */
  openNotificationSettings: () => Promise<void>
  /** 切换通知提示音（保存 + 试听一次；静音不播放） */
  setNoticeSound: (v: string) => Promise<void>
  /** 配对成功后调用：保存/更新配对记录并设为当前电脑 */
  commitPairing: () => Promise<void>
  /** 切换当前操作的电脑（断开重连） */
  switchDesktop: (desktopId: string) => Promise<void>
  /** 解绑某台电脑；返回是否解绑的是当前电脑（需要跳配对页） */
  unbindDesktop: (desktopId: string) => Promise<boolean>
  handleAgentEvent: (e: AgentEvent) => void
}

export const useRelayStore = create<RelayStoreState>((set, get) => ({
  status: { connected: false, peerOnline: false, peer: null, lastError: null },
  sessions: [],
  messages: {},
  loadingSessions: false,
  loadingMessages: {},
  jobs: [],
  loadingJobs: false,
  jobRuns: {},
  artifacts: {},
  runMeta: {},
  historicRuns: {},
  libraryItems: [],
  notes: [],
  loadingLibrary: false,
  scheduleError: null,
  libraryError: null,
  notifyEnabled: true,
  notifyPermission: true,
  noticeSound: "灵动",
  pairings: [],
  currentDesktopId: null,

  setStatus: (s) => set({ status: s }),

  loadSessions: async () => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    set({ loadingSessions: true })
    try {
      const list = await c.call<SessionSummary[]>(SESSION_LIST)
      set({ sessions: list ?? [] })
    } finally {
      set({ loadingSessions: false })
    }
  },

  loadMessages: async (sessionId) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionId]: true } }))
    try {
      // 消息 + 任务轨迹并行拉取（runs 失败不影响消息展示）
      const [list, runs] = await Promise.all([
        c.call<ChatMessage[]>(SESSION_MESSAGES, { sessionId }),
        c.call<AgentRunSummary[]>("session.runs", { sessionId }).catch(() => [] as AgentRunSummary[]),
      ])
      const runMap: Record<string, RunMeta> = {}
      for (const r of runs ?? []) {
        runMap[r.id] = {
          startedAt: r.started_at,
          status: r.status ?? "completed",
          durationMs: r.duration_ms,
          toolCallCount: r.tool_call_count ?? 0,
        }
      }
      set((s) => ({
        messages: { ...s.messages, [sessionId]: list ?? [] },
        historicRuns: { ...s.historicRuns, [sessionId]: runMap },
      }))
    } finally {
      set((s) => {
        const next = { ...s.loadingMessages }
        delete next[sessionId]
        return { loadingMessages: next }
      })
    }
  },

  loadArtifacts: async (sessionId) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    try {
      const list = await c.call<ArtifactItem[]>("session.artifacts", { sessionId })
      set((s) => ({ artifacts: { ...s.artifacts, [sessionId]: Array.isArray(list) ? list : [] } }))
    } catch {
      // 桌面端版本过旧/离线：产物区域静默不展示
      set((s) => ({ artifacts: { ...s.artifacts, [sessionId]: [] } }))
    }
  },

  readArtifact: async (sessionId, relPath) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return null
    return await c.call<{ path: string; content: string | null; size: number }>("artifact.read", { sessionId, path: relPath })
  },

  createTask: async (prompt, model, attachments) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    return await c.call<{ sessionId: string }>(TASK_CREATE, { prompt, model, attachments })
  },

  sendMessage: async (sessionId, message, attachments) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    const r = await c.call<{ ok: boolean }>(SESSION_SEND, { sessionId, message, attachments })
    // 带图发送后整列刷新：桌面端 insertUser 同步先于 reply（无竞争），DB 行带回附件 dataUrl，
    // 整体替换 message.user 事件推来的无图气泡
    if (r?.ok && attachments?.length) await get().loadMessages(sessionId)
    return r?.ok ?? false
  },

  searchLibrary: async (query) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    const r = await c.call<LibrarySearchResult[]>(LIBRARY_SEARCH, { query })
    return r ?? []
  },

  // ===== 定时任务 =====
  loadJobs: async () => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    set({ loadingJobs: true, scheduleError: null })
    try {
      const list = await c.call<ScheduledJobSummary[]>(SCHEDULE_LIST)
      set({ jobs: Array.isArray(list) ? list : [] })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ scheduleError: msg.includes("超时") ? "桌面端无响应，请完全重启桌面端后重试" : msg })
    } finally {
      set({ loadingJobs: false })
    }
  },

  loadJobRuns: async (jobId) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    try {
      const list = await c.call<JobRunSummary[]>(SCHEDULE_RUNS, { jobId })
      set((s) => ({ jobRuns: { ...s.jobRuns, [jobId]: Array.isArray(list) ? list : [] } }))
    } catch {
      set((s) => ({ jobRuns: { ...s.jobRuns, [jobId]: [] } }))
    }
  },

  // ===== 资料库（知识库条目 + 笔记）=====
  loadLibrary: async () => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    set({ loadingLibrary: true, libraryError: null })
    try {
      const [kbRes, noteRes] = await Promise.all([
        c.call<{ items: LibraryItemSummary[] }>(LIBRARY_LIST),
        c.call<{ notes: LibraryItemSummary[] }>("note.list"),
      ])
      // 文件 tab：知识库全量条目（文章/文档/图片/金句 type=note 均归入文件，与桌面端资料库对齐）
      // 笔记 tab：仅 note 表的纯笔记（note.list 全量返回，无分页截断）
      const kbItems = kbRes?.items ?? []
      const noteRows = noteRes?.notes ?? []
      const pureNotes = noteRows.map((n) => ({
        id: n.id,
        title: n.title ?? "未命名笔记",
        summary: String(n.content ?? "").slice(0, 80),
        type: "note" as const,
        source_url: `note:${n.id}`,
        created_at: n.created_at,
        updated_at: n.updated_at,
      }))
      set({
        libraryItems: kbItems,
        notes: pureNotes,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ libraryError: msg.includes("超时") ? "桌面端无响应，请完全重启桌面端后重试" : msg })
    } finally {
      set({ loadingLibrary: false })
    }
  },

  loadLibraryItem: async (id) => {
    const cached = readLibraryItemCache(id)
    if (cached) return cached
    const c = getRelayClient()
    if (!c || !c.status.connected) return null
    let item: LibraryItemSummary | null = null
    if (id.startsWith("note:")) {
      // note 表条目（未入知识库）
      const n = await c.call<{ id: string; title: string; content?: string } | null>("note.get", { id: id.slice(5) })
      item = n ? { id, title: n.title, content: n.content ?? "", type: "note" } : null
    } else {
      item = await c.call<LibraryItemSummary | null>(LIBRARY_ITEM, { id })
    }
    if (item) writeLibraryItemCache(id, item)
    return item
  },

  createNote: async (params) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    const r = await c.call<unknown>("note.create", params)
    // 新增后刷新资料库列表（笔记 tab 立即可见）
    void get().loadLibrary()
    return r
  },

  setNotifyEnabled: async (v) => {
    // Expo Go 等无系统通知能力的环境：开关只控制应用内提醒
    if (!pushAvailable) {
      set({ notifyEnabled: v })
      await storage.setNotifyEnabled(v)
      return
    }
    if (v) {
      // 打开开关即申请系统通知权限（Android 13+ / iOS 会弹系统授权框）
      const ok = await ensureNotificationPermission()
      set({ notifyEnabled: ok, notifyPermission: ok })
      await storage.setNotifyEnabled(ok)
      if (!ok) {
        // 权限被永久拒绝时系统不再弹框，只能引导用户去系统设置里手动开启
        Alert.alert(
          "通知权限未开启",
          "系统通知权限被拒绝。可在系统设置中允许 Nexa 发送通知；应用在前台时仍会正常提醒。",
          [
            { text: "稍后", style: "cancel" },
            { text: "去设置", onPress: () => void openSystemNotificationSettings() },
          ]
        )
      }
      return
    }
    // 关闭开关：Android 不允许 App 自行撤销通知权限，
    // 这里先关掉应用内提醒并清理待发通知，再直接把用户带到系统设置真正关闭通知
    set({ notifyEnabled: false })
    await storage.setNotifyEnabled(false)
    void cancelPendingNotifications()
    await openSystemNotificationSettings()
  },

  refreshNotifyPermission: async () => {
    // Expo Go 等无系统通知能力的环境不做联动
    if (!pushAvailable) return
    const ok = await hasNotificationPermission()
    set({ notifyPermission: ok })
    // 开关与系统权限双向对齐：系统里关了就关，系统里开了就开
    if (ok !== get().notifyEnabled) {
      set({ notifyEnabled: ok })
      await storage.setNotifyEnabled(ok)
    }
  },

  openNotificationSettings: async () => {
    await openSystemNotificationSettings()
  },

  setNoticeSound: async (v) => {
    set({ noticeSound: v })
    await storage.setNoticeSound(v)
    // 试听（与桌面端切换即试听一致；静音不播放）
    void playNoticeSound(v)
  },

  // ===== 多电脑配对 =====
  commitPairing: async () => {
    const c = getRelayClient()
    if (!c) return
    const peer = c.status.peer
    const token = c.token
    if (!peer || !token) return
    const entry: RelayPairing = {
      desktopId: peer.deviceId,
      name: peer.name || "我的电脑",
      token,
      relayUrl: c.relayUrl,
    }
    const pairings = (await storage.getPairings()).filter((p) => p.desktopId !== entry.desktopId)
    pairings.push(entry)
    await storage.setPairings(pairings)
    await storage.setCurrentDesktopId(entry.desktopId)
    // 兼容旧字段（旧版本读取单 token）
    await storage.setRelayUrl(entry.relayUrl)
    await storage.setToken(token)
    set({ pairings, currentDesktopId: entry.desktopId })
  },

  switchDesktop: async (desktopId) => {
    const pairings = await storage.getPairings()
    const target = pairings.find((p) => p.desktopId === desktopId)
    if (!target) throw new Error("配对记录不存在")
    // 断开旧连接，用目标电脑的 token 重连
    if (client) {
      client.shutdown()
      client = null
    }
    const identity = await getDeviceIdentity()
    client = new RelayClient({
      relayUrl: target.relayUrl,
      deviceId: identity.deviceId,
      name: identity.name,
      token: target.token,
    })
    wireClient(client)
    await storage.setCurrentDesktopId(desktopId)
    await storage.setRelayUrl(target.relayUrl)
    await storage.setToken(target.token)
    set((s) => ({
      pairings,
      currentDesktopId: desktopId,
      status: { connected: false, peerOnline: false, peer: null, lastError: null },
      sessions: [],
      messages: {},
      jobs: [],
      libraryItems: [],
      notes: [],
      jobRuns: {},
    }))
    void client.start()
  },

  unbindDesktop: async (desktopId) => {
    const pairings = (await storage.getPairings()).filter((p) => p.desktopId !== desktopId)
    await storage.setPairings(pairings)
    const currentId = await storage.getCurrentDesktopId()
    if (currentId === desktopId) {
      // 解绑的是当前电脑：断开并清空，需要重新配对
      if (client) {
        client.shutdown()
        client = null
      }
      await storage.clearToken()
      set({
        pairings,
        currentDesktopId: null,
        status: { connected: false, peerOnline: false, peer: null, lastError: null },
        sessions: [],
        messages: {},
      })
      return true
    }
    set({ pairings })
    return false
  },

  handleAgentEvent: (e) => {
    const type = String(e.type ?? "")

    // 定时任务完成/失败通知（无 sessionId，须在 sid 守卫前处理）
    if (type === "scheduler:notify") {
      if (get().notifyEnabled) {
        const success = Boolean(e.success)
        const description = String(e.description ?? "定时任务")
        const output = String(e.output ?? "").slice(0, 300)
        const title = success ? "定时任务完成" : "定时任务失败"
        const sound = get().noticeSound
        if (AppState.currentState === "active") {
          // 前台：应用内弹窗 + 合成提示音（避免系统通知与应用内提示重复）
          void playNoticeSound(sound)
          Alert.alert(title, `${description}\n${output}`)
        } else {
          // 后台/锁屏：走系统通知；静音选项映射到静音渠道。
          // Expo Go 无原生通知模块或用户未授权时回退应用内提醒
          void showTaskNotification({ title, body: `${description}\n${output}`, silent: sound === "静音" }).then((shown) => {
            if (!shown) {
              void playNoticeSound(sound)
              Alert.alert(title, `${description}\n${output}`)
            }
          })
        }
      }
      return
    }

    // 流式消息处理（注意：桌面端 delta 事件字段为 delta 而非 content，且携带消息 id）
    const sid = String(e.sessionId ?? "")
    if (!sid) return
    const mid = String(e.id ?? "")

    // 任务轨迹：开始/结束事件驱动「任务耗时」摘要条（对齐桌面端 RunTrace）
    if (type === "run.started") {
      set((s) => ({
        runMeta: {
          ...s.runMeta,
          [sid]: { startedAt: Number(e.ts ?? Date.now()), status: "running", durationMs: null, toolCallCount: 0 },
        },
      }))
      return
    }
    if (type === "run.finished") {
      const status = String(e.status ?? "completed") as RunMeta["status"]
      const durationMs = e.durationMs != null ? Number(e.durationMs) : null
      const toolCallCount = e.toolCallCount != null ? Number(e.toolCallCount) : 0
      set((s) => ({
        runMeta: {
          ...s.runMeta,
          [sid]: {
            // 保留原 startedAt（结束事件不带），缺失时用倒推的起点
            startedAt: s.runMeta[sid]?.startedAt ?? Date.now() - (durationMs ?? 0),
            status: status === "running" ? "completed" : status,
            durationMs,
            toolCallCount,
          },
        },
      }))
      return
    }

    // 找到流式目标（按消息 id 精确匹配），返回浅拷贝数组 + 是否命中
    const upsert = (
      arr: ChatMessage[],
      patch: (m: ChatMessage) => ChatMessage,
      create: () => ChatMessage
    ): { arr: ChatMessage[]; hit: boolean } => {
      const idx = mid ? arr.findIndex((m) => m.id === mid) : -1
      if (idx >= 0) {
        const next = [...arr]
        next[idx] = patch(next[idx])
        return { arr: next, hit: true }
      }
      return { arr: [...arr, create()], hit: false }
    }

    if (type === "message.thinking.delta") {
      // 思考过程流（reasoning 模型），追加到 assistant 消息的 thinking 字段
      const delta = String(e.delta ?? "")
      if (!delta) return
      set((s) => {
        const list = s.messages[sid] ?? []
        const r = upsert(
          list,
          (m) => ({ ...m, thinking: (m.thinking ?? "") + delta, done: false }),
          () => ({ id: mid || `think-${Date.now()}`, role: "assistant", content: "", thinking: delta, done: false, createdAt: Math.floor(Date.now() / 1000) })
        )
        return { messages: { ...s.messages, [sid]: r.arr } }
      })
    } else if (type === "message.assistant.delta") {
      const delta = String(e.delta ?? "")
      if (!delta) return
      set((s) => {
        const list = s.messages[sid] ?? []
        const r = upsert(
          list,
          (m) => ({ ...m, content: m.content + delta, done: false }),
          () => ({ id: mid || `delta-${Date.now()}`, role: "assistant", content: delta, done: false, createdAt: Math.floor(Date.now() / 1000) })
        )
        return { messages: { ...s.messages, [sid]: r.arr } }
      })
    } else if (type === "message.assistant.done") {
      const content = String(e.content ?? "")
      const thinking = e.thinking != null ? String(e.thinking) : null
      // 底栏展示用：模型标识与 token 用量（事件里已带，无需再查库）
      const model = e.model != null ? String(e.model) : null
      const usage = (e.usage ?? null) as ChatMessage["usage"]
      set((s) => {
        const list = s.messages[sid] ?? []
        const r = upsert(
          list,
          (m) => ({ ...m, content, thinking: thinking ?? m.thinking, done: true, model: model ?? m.model, usage: usage ?? m.usage }),
          () => ({ id: mid || `done-${Date.now()}`, role: "assistant", content, thinking, done: true, model, usage, createdAt: Math.floor(Date.now() / 1000) })
        )
        return { messages: { ...s.messages, [sid]: r.arr } }
      })
    } else if (type === "message.user") {
      const content = String(e.content ?? "")
      set((s) => {
        const arr = [...(s.messages[sid] ?? [])]
        arr.push({ id: `u-${Date.now()}`, role: "user", content, createdAt: Math.floor(Date.now() / 1000) })
        return { messages: { ...s.messages, [sid]: arr } }
      })
    }
    // 会话列表：有新会话/标题更新时刷新
    if (type === "session.created" || type === "session.updated") {
      void get().loadSessions()
    }
  },
}))
