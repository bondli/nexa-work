/// <reference lib="dom" />
import { contextBridge, ipcRenderer } from "electron"
import { IPC, AGENT_EVENT, RELAY_EVENT, NOTIFY_EVENT } from "@shared/ipc-channels"
import type {
  AgentEvent,
  AttachmentInput,
  NoticeEvent,
  RelayStatus,
  SessionCreateParams,
} from "@shared/ipc-channels"

/**
 * preload 脚本 - 通过 contextBridge 暴露安全 API 到渲染进程
 * 渲染进程通过 window.nexa 访问所有 IPC 能力
 */
const api = {
  // ===== 会话管理 =====
  sessionCreate: (params: SessionCreateParams) =>
    ipcRenderer.invoke(IPC.SESSION_CREATE, params),

  sessionSend: (params: { sessionId: string; message: string; attachments?: AttachmentInput[] }) =>
    ipcRenderer.invoke(IPC.SESSION_SEND, params),

  sessionPause: (sessionId: string) =>
    ipcRenderer.invoke(IPC.SESSION_PAUSE, { sessionId }),

  sessionResume: (sessionId: string) =>
    ipcRenderer.invoke(IPC.SESSION_RESUME, { sessionId }),

  sessionDelete: (sessionId: string) =>
    ipcRenderer.invoke(IPC.SESSION_DELETE, { sessionId }),

  humanResponse: (params: { sessionId: string; questionId: string; choice: string }) =>
    ipcRenderer.invoke(IPC.HUMAN_RESPONSE, params),

  listSessions: (params?: { filter?: string; search?: string; archived?: boolean }) =>
    ipcRenderer.invoke(IPC.SESSION_LIST, params ?? {}),

  loadMessages: (sessionId: string) =>
    ipcRenderer.invoke(IPC.SESSION_MESSAGES, { sessionId }),

  sessionRuns: (sessionId: string) =>
    ipcRenderer.invoke(IPC.SESSION_RUNS, { sessionId }),

  sessionRename: (params: { sessionId: string; title: string }) =>
    ipcRenderer.invoke(IPC.SESSION_RENAME, params),

  sessionArchive: (params: { sessionId: string; archived: boolean }) =>
    ipcRenderer.invoke(IPC.SESSION_ARCHIVE, params),

  sessionReveal: (sessionId: string) =>
    ipcRenderer.invoke(IPC.SESSION_REVEAL, { sessionId }),

  openDirectoryPicker: () =>
    ipcRenderer.invoke(IPC.OPEN_DIRECTORY_PICKER),

  // ===== 工作区文件（产物面板） =====
  workspaceList: (sessionId: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_LIST, { sessionId }),

  workspaceRead: (sessionId: string, path: string) =>
    ipcRenderer.invoke(IPC.WORKSPACE_READ, { sessionId, path }),

  /** 自由任务 workspace 产出的文档列表（资料库「文档」数据源） */
  workspaceDocsList: () =>
    ipcRenderer.invoke(IPC.WORKSPACE_DOCS_LIST),

  /** 产物 HTML 预览静态服务地址（127.0.0.1 随机端口） */
  getArtifactPreviewBase: () =>
    ipcRenderer.invoke(IPC.ARTIFACT_PREVIEW_BASE),

  /** 读取消息附件为 dataURL（仅 ~/.nexa/uploads 内文件） */
  attachmentRead: (filePath: string) =>
    ipcRenderer.invoke(IPC.ATTACHMENT_READ, filePath),

  // ===== 笔记 =====
  noteList: (params?: { category?: string; status?: string; search?: string }) =>
    ipcRenderer.invoke(IPC.NOTE_LIST, params ?? {}),

  noteGet: (id: string) =>
    ipcRenderer.invoke(IPC.NOTE_GET, id),

  noteCreate: (params: { title: string; content?: string; status?: string; category?: string; tags?: string[] }) =>
    ipcRenderer.invoke(IPC.NOTE_CREATE, params),

  noteUpdate: (id: string, params: { title?: string; content?: string; status?: string; category?: string; tags?: string[] }) =>
    ipcRenderer.invoke(IPC.NOTE_UPDATE, id, params),

  noteDelete: (id: string) =>
    ipcRenderer.invoke(IPC.NOTE_DELETE, id),

  noteCategories: () =>
    ipcRenderer.invoke(IPC.NOTE_CATEGORIES, {}),

  noteAddCategory: (params: { name: string; icon?: string }) =>
    ipcRenderer.invoke(IPC.NOTE_ADD_CATEGORY, params),

  noteRemoveCategory: (id: string) =>
    ipcRenderer.invoke(IPC.NOTE_REMOVE_CATEGORY, id),

  // ===== 知识库 (M4) =====
  kbList: (opts?: { type?: string; limit?: number }) =>
    ipcRenderer.invoke(IPC.KB_LIST, opts ?? {}),

  kbGet: (id: string) =>
    ipcRenderer.invoke(IPC.KB_GET, id),

  kbSearch: (params: { query: string; type?: string; topN?: number }) =>
    ipcRenderer.invoke(IPC.KB_SEARCH, params),

  kbAddNote: (params: { title?: string; content: string; workspaceId?: string | null }) =>
    ipcRenderer.invoke(IPC.KB_ADD_NOTE, params),

  kbAddArticle: (params: { url: string; html?: string; title?: string; workspaceId?: string | null }) =>
    ipcRenderer.invoke(IPC.KB_ADD_ARTICLE, params),

  kbAddImage: (params: { filePath: string; title?: string; description?: string; workspaceId?: string | null }) =>
    ipcRenderer.invoke(IPC.KB_ADD_IMAGE, params),

  kbAddDoc: (params: { title?: string; content: string; workspaceId?: string | null }) =>
    ipcRenderer.invoke(IPC.KB_ADD_DOC, params),

  kbDelete: (id: string) =>
    ipcRenderer.invoke(IPC.KB_DELETE, id),

  /** 知识库图片原图 dataURL（资料库缩略图 / 大图预览） */
  kbImageRead: (id: string) =>
    ipcRenderer.invoke(IPC.KB_IMAGE_READ, id),

  // ===== 记忆 (M4) =====
  memoryList: (filter?: { layer?: string; minConfidence?: number }) =>
    ipcRenderer.invoke(IPC.MEMORY_LIST, filter ?? {}),

  memoryUpsert: (item: { layer: string; category: string; content: string; confidence?: number }) =>
    ipcRenderer.invoke(IPC.MEMORY_UPSERT, item),

  memoryUpdate: (id: string, patch: { content?: string; confidence?: number; category?: string; layer?: string }) =>
    ipcRenderer.invoke(IPC.MEMORY_UPDATE, id, patch),

  memoryDelete: (id: string) =>
    ipcRenderer.invoke(IPC.MEMORY_DELETE, id),

  // ===== 定时任务 (M5) =====
  jobList: () =>
    ipcRenderer.invoke(IPC.JOB_LIST),

  jobToggle: (params: { id: string; enabled: boolean }) =>
    ipcRenderer.invoke(IPC.JOB_TOGGLE, params),

  jobDelete: (id: string) =>
    ipcRenderer.invoke(IPC.JOB_DELETE, id),

  jobRunNow: (id: string) =>
    ipcRenderer.invoke(IPC.JOB_RUN_NOW, id),

  /** 全部任务的执行记录（按 started_at 倒序，分页；offset=0 取最新一批） */
  jobRuns: (params?: { limit?: number; offset?: number }) =>
    ipcRenderer.invoke(IPC.JOB_RUNS, params ?? {}),

  jobStats: () =>
    ipcRenderer.invoke(IPC.JOB_STATS),

  // ===== 手机中继 (M5b) =====
  relayStatus: () =>
    ipcRenderer.invoke(IPC.RELAY_STATUS),

  relaySetUrl: (url: string) =>
    ipcRenderer.invoke(IPC.RELAY_SET_URL, url),

  relayCreatePairing: () =>
    ipcRenderer.invoke(IPC.RELAY_CREATE_PAIRING),

  relayUnbind: (deviceId: string) =>
    ipcRenderer.invoke(IPC.RELAY_UNBIND, deviceId),

  // ===== 专家 =====
  expertList: () =>
    ipcRenderer.invoke(IPC.EXPERT_LIST),

  sessionSetExpert: (params: { sessionId: string; expertId: string }) =>
    ipcRenderer.invoke(IPC.SESSION_SET_EXPERT, params),

  sessionSetModel: (params: { sessionId: string; model: string }) =>
    ipcRenderer.invoke(IPC.SESSION_SET_MODEL, params),

  // ===== Skill =====
  skillList: () =>
    ipcRenderer.invoke(IPC.SKILL_LIST),

  skillToggle: (params: { id: string; enabled: boolean }) =>
    ipcRenderer.invoke(IPC.SKILL_TOGGLE, params),

  // ===== 连接器 =====
  connectorList: () =>
    ipcRenderer.invoke(IPC.CONNECTOR_LIST),

  connectorTest: (id: string) =>
    ipcRenderer.invoke(IPC.CONNECTOR_TEST, id),

  connectorGet: (id: string) =>
    ipcRenderer.invoke(IPC.CONNECTOR_GET, id),

  connectorSave: (params: { id: string; yaml: string; previousId?: string }) =>
    ipcRenderer.invoke(IPC.CONNECTOR_SAVE, params),

  connectorDelete: (id: string) =>
    ipcRenderer.invoke(IPC.CONNECTOR_DELETE, id),

  // ===== 专家管理 =====
  expertGet: (id: string) =>
    ipcRenderer.invoke(IPC.EXPERT_GET, id),

  expertSave: (params: { id?: string; name: string; description: string; systemPrompt: string; tools?: string[]; disallowTools?: string[] }) =>
    ipcRenderer.invoke(IPC.EXPERT_SAVE, params),

  expertDelete: (id: string) =>
    ipcRenderer.invoke(IPC.EXPERT_DELETE, id),

  // ===== Skill 管理 =====
  skillGet: (id: string) =>
    ipcRenderer.invoke(IPC.SKILL_GET, id),

  skillSave: (params: { id: string; yaml: string }) =>
    ipcRenderer.invoke(IPC.SKILL_SAVE, params),

  skillDelete: (id: string) =>
    ipcRenderer.invoke(IPC.SKILL_DELETE, id),

  // ===== 主题 =====
  getTheme: () =>
    ipcRenderer.invoke(IPC.GET_THEME),

  setTheme: (theme: "light" | "dark" | "system") =>
    ipcRenderer.invoke(IPC.SET_THEME, theme),

  // ===== 设置 =====
  getSettings: () =>
    ipcRenderer.invoke(IPC.GET_SETTINGS),

  setSettings: (update: unknown) =>
    ipcRenderer.invoke(IPC.SET_SETTINGS, update),

  // ===== 通知 =====
  /** 打开系统「通知」偏好设置 */
  openNotificationSettings: () =>
    ipcRenderer.invoke(IPC.OPEN_NOTIFICATION_SETTINGS),

  /** 在 Finder / Explorer 中打开绝对路径 */
  openFolder: (absolutePath: string) =>
    ipcRenderer.invoke(IPC.OPEN_FOLDER, absolutePath),

  /** 订阅桌面通知事件（播放提示音） */
  onNotify: (handler: (payload: NoticeEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: NoticeEvent) => handler(payload)
    ipcRenderer.on(NOTIFY_EVENT, listener)
    return () => ipcRenderer.removeListener(NOTIFY_EVENT, listener)
  },

  // ===== Agent 事件订阅 =====
  onEvent: (handler: (event: AgentEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: AgentEvent) => handler(payload)
    ipcRenderer.on(AGENT_EVENT, listener)
    return () => ipcRenderer.removeListener(AGENT_EVENT, listener)
  },

  // ===== 中继状态事件订阅 (M5b) =====
  onRelayEvent: (handler: (status: RelayStatus) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: RelayStatus) => handler(payload)
    ipcRenderer.on(RELAY_EVENT, listener)
    return () => ipcRenderer.removeListener(RELAY_EVENT, listener)
  },
}

export type NexaAPI = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("nexa", api)
} else {
  ;(globalThis as unknown as Record<string, unknown>).nexa = api
}
