import { app, BrowserWindow, shell, ipcMain, nativeTheme, Notification } from "electron"
import { appendFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs"
import http from "node:http"
import { join, resolve, relative, isAbsolute, extname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

// dev 调试: 允许外部 CDP 连接（electron-vite 的 REMOTE_DEBUGGING_PORT 会自动加 port）
if (process.env.NODE_ENV !== "production") {
  app.commandLine.appendSwitch("remote-allow-origins", "*")
}
import { IPC, AGENT_EVENT, RELAY_EVENT, NOTIFY_EVENT } from "@shared/ipc-channels"
import type { AgentEvent, AttachmentInput, ExpertSaveParams, NoticeEvent, SessionCreateParams, WorkspaceDocItem, WorkspaceFileNode, WorkspaceReadResponse } from "@shared/ipc-channels"
import { initDatabase, getDatabase } from "./db/database"
import type { KnowledgeItem, MemoryItem } from "./db/types"
import { AgentRuntime } from "./agent/runtime"
import { normalizeTitle } from "./agent/llm-helper"
import { readAttachmentDataUrl, saveAttachments } from "./attachments"
import { resolveModel, loadSettings, saveSettings, getApiKey } from "./agent/settings"
import { ExpertRegistry } from "./experts/registry"
import { SkillRegistry, runSkill } from "./skills/registry"
import { ConnectorManager } from "./connectors/registry"
import { KnowledgeBaseService } from "./knowledge/service"
import { MemoryEngine } from "./agent/memory-engine"
import { SchedulerService, runNodeScript } from "./scheduler/scheduler-service"
import { computeNextRunSeconds } from "./scheduler/cron"
import { RelayClient } from "./relay/relay-client"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

/**
 * 单实例锁：同一时刻只允许运行一个桌面端。
 * 多开会各自初始化 sql.js（整库读写回同一文件，后写覆盖先写），
 * 且会用同一个 deviceId 争抢中继连接（手机端因此表现为「一会儿在线一会儿离线」）。
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // 拿不到锁说明已有实例在运行，交给已有实例处理（second-instance），本次直接退出
  app.quit()
} else {
  // 重复启动时把已有窗口唤到前台，而不是再开一个窗口
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  })
}

/** Agent Runtime 实例（whenReady 后初始化） */
let agentRuntime: AgentRuntime | null = null
/** 产物 HTML 预览静态服务地址（whenReady 后初始化，如 http://127.0.0.1:54321） */
let artifactPreviewBase = ""
/** 专家注册表（whenReady 后初始化） */
let expertRegistry: ExpertRegistry | null = null
/** Skill 注册表（whenReady 后初始化） */
let skillRegistry: SkillRegistry | null = null
/** 连接器管理器（whenReady 后初始化） */
let connectorManager: ConnectorManager | null = null
/** 知识库服务（whenReady 后初始化） */
let knowledgeBase: KnowledgeBaseService | null = null
/** 记忆引擎（whenReady 后初始化） */
let memoryEngine: MemoryEngine | null = null
/** 定时任务调度器（whenReady 后初始化） */
let scheduler: SchedulerService | null = null
/** 手机中继客户端（whenReady 后初始化） */
let relayClient: RelayClient | null = null

/** 主窗口引用 */
let mainWindow: BrowserWindow | null = null

/** 图片扩展名（工作区文件 / 知识库图片 dataURL 判定共用，模块级常量） */
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"])

/** 产物面板忽略的目录/文件：依赖、版本控制、隐藏文件 */
const WORKSPACE_IGNORE = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv",
  // 系统 / IDE 产物（不需要展示，且通常无需关心）
  ".DS_Store", "Thumbs.db", ".Spotlight-V100", ".Trashes", ".fseventsd",
  ".idea", ".vscode", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
])
const TEXT_SIZE_LIMIT = 512 * 1024 // 超过 512KB 的文本不读内容

/** 视为「最终产物」的文档类扩展名（产物面板 / 手机端产物卡共用） */
const DOC_EXTS = new Set([".md", ".markdown", ".html", ".htm"])

/** 校验 rel 在 workspace 内，返回绝对路径 */
function assertInWorkspace(workspacePath: string, rel: string): string {
  const abs = resolve(workspacePath, rel)
  const r = relative(workspacePath, abs)
  if (r.startsWith("..") || isAbsolute(r)) throw new Error(`路径越界: ${rel}`)
  return abs
}

/** 递归列文件树（跳过 node_modules/.git/隐藏目录，深度 5 层，最多 800 项） */
function listWorkspaceTree(workspacePath: string, rel: string, depth: number, budget: { count: number }): WorkspaceFileNode[] {
  if (depth > 5 || budget.count > 800) return []
  const abs = assertInWorkspace(workspacePath, rel || ".")
  let entries: Dirent[]
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: WorkspaceFileNode[] = []
  for (const ent of entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))) {
    if (budget.count > 800) break
    if (WORKSPACE_IGNORE.has(ent.name)) continue
    const childRel = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      budget.count++
      nodes.push({ name: ent.name, path: childRel, type: "directory", children: listWorkspaceTree(workspacePath, childRel, depth + 1, budget) })
    } else {
      budget.count++
      let size: number | undefined
      try {
        size = statSync(join(abs, ent.name)).size
      } catch {
        /* stat 失败忽略 */
      }
      nodes.push({ name: ent.name, path: childRel, type: "file", size })
    }
  }
  return nodes
}

/** 递归收集 workspace 中产出的文档（md/html），供资料库文档 tab 与手机端产物卡复用 */
function collectDocs(workspacePath: string, rel: string, depth: number, out: { relPath: string; name: string; mtime: number; size: number }[], budget: { count: number }): void {
  if (depth > 5 || budget.count > 800 || out.length >= 500) return
  let entries: Dirent[]
  try {
    entries = readdirSync(assertInWorkspace(workspacePath, rel || "."), { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (budget.count > 800 || out.length >= 500) return
    if (WORKSPACE_IGNORE.has(ent.name)) continue
    const childRel = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      budget.count++
      collectDocs(workspacePath, childRel, depth + 1, out, budget)
    } else if (DOC_EXTS.has(extname(ent.name).toLowerCase())) {
      budget.count++
      try {
        const st = statSync(join(workspacePath, childRel))
        out.push({ relPath: childRel, name: ent.name, mtime: Math.floor(st.mtimeMs / 1000), size: st.size })
      } catch {
        /* stat 失败忽略 */
      }
    }
  }
}

/**
 * 创建主窗口
 * - titleBarStyle: hiddenInset - macOS 隐藏标题栏，交通灯按钮内嵌
 * - trafficLightPosition: 避让侧边栏 52px 折叠宽度
 */
function createWindow(): void {
  const preloadPath = join(__dirname, "../preload/index.cjs")
  if (!existsSync(preloadPath)) flog(`WARN: preload not found at ${preloadPath}`)
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: realpathSync(preloadPath),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 窗口准备好再显示，避免白闪
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show()
  })

  // 允许 target=_blank 在系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // dev 模式加载 Vite dev server，生产模式加载打包文件
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

/** 窗口是否在最前端且可见（不可见 / 最小化 / 失焦时需要弹系统通知提醒） */
function isWindowVisibleForeground(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  return mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()
}

/**
 * 弹出桌面通知（任务完成 / 定时任务产物生成），并通知渲染端播放提示音
 * 系统通知设为静音，声音统一交给渲染端按设置播放，避免系统声与自定义提示音双响
 */
function showDesktopNotice(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      const notice = new Notification({ title, body, silent: true })
      // 点击通知回到应用（不切换会话，避免跨进程额外事件）
      notice.on("click", () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      })
      notice.show()
    }
  } catch (err) {
    flog("showDesktopNotice failed: " + (err instanceof Error ? err.message : String(err)))
  }
  // 提示音只在窗口存在时播放（窗口关闭后无法播放，此时仅系统通知本身可见）
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    const payload: NoticeEvent = { title, body, sound: loadSettings().notificationSound || "灵动" }
    mainWindow.webContents.send(NOTIFY_EVENT, payload)
  }
}

/**
 * 推送 Agent 事件到渲染进程
 */
export function sendAgentEvent(event: AgentEvent): void {
  // 任务完成 / 失败且窗口不在前台 → 桌面通知（定时任务触发的会话由定时任务通知负责，避免重复）
  if (event.type === "run.finished" && event.status !== "paused" && !isWindowVisibleForeground()) {
    if (!scheduler?.isSessionRunning(event.sessionId)) {
      const title = getDatabase().session.get(event.sessionId)?.title || "Nexa"
      showDesktopNotice(
        title,
        event.status === "completed" ? "任务已完成，点击查看结果" : "任务执行失败，点击查看详情",
      )
    }
  }
  if (!mainWindow) {
    flog(`sendAgentEvent FAIL: mainWindow is null`)
    return
  }
  if (mainWindow.webContents.isDestroyed()) {
    flog(`sendAgentEvent FAIL: webContents destroyed`)
    return
  }
  flog(`sendAgentEvent: ${event.type} (session: ${event.sessionId ?? "n/a"})`)
  mainWindow.webContents.send(AGENT_EVENT, event)
  // M5b：同步转发到已配对手机（无配对/未连接时内部 no-op）
  relayClient?.forwardAgentEvent(event)
}

/**
 * 确保 free 模式的 workspace 目录存在
 */
function ensureWorkspaceDir(mode: "free" | "project", id: string, projectPath?: string): string {
  if (mode === "project" && projectPath) return projectPath
  const wsDir = join(homedir(), ".nexa", "workspaces", id)
  if (!existsSync(wsDir)) mkdirSync(wsDir, { recursive: true })
  return wsDir

}

/**
 * 创建会话并异步启动 Agent Loop（IPC 与手机中继共用）
 * model 必须是已解析的 "provider/modelId"
 */
async function createSessionInternal(params: SessionCreateParams): Promise<{ sessionId: string; title: string; mode: string }> {
  const db = getDatabase()
  flog(`createSessionInternal: ${params.initialMessage?.slice(0, 30)}`)
  const id = randomUUID()
  const wsPath = ensureWorkspaceDir(params.mode, id, params.projectPath)
  const expert = params.expertId ? expertRegistry!.get(params.expertId) : expertRegistry!.getDefault()
  const session = db.session.create({
    id,
    // 兜底标题：剥离 Markdown 结构（"## Goal" 等）后再截断；LLM 标题生成成功后会被 session.title 事件覆盖
    title: normalizeTitle(params.initialMessage, 30) || "新任务",
    mode: params.mode,
    workspace_path: wsPath,
    project_path: params.projectPath ?? null,
    model: params.model,
    current_expert: expert?.id ?? null,
  })
  // 附件先落盘（~/.nexa/uploads/<sessionId>/），再随首条消息交给 runtime
  const attachments = saveAttachments(id, params.attachments)
  // 必须延迟到下一 tick：startSession 会同步推送 message.user 事件，
  // 若先于调用方响应到达渲染端，conv 空壳尚未创建，首条用户消息会被丢弃
  setTimeout(() => {
    void agentRuntime!.startSession(session, params.initialMessage, attachments).catch((err: unknown) => {
      flog("startSession failed: " + (err instanceof Error ? err.message : String(err)))
      sendAgentEvent({
        type: "error",
        sessionId: id,
        code: "session_start_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }, 0)
  return { sessionId: session.id, title: session.title, mode: session.mode }
}

/**
 * 注册 IPC 处理器
 */
function registerIpcHandlers(): void {
  const db = getDatabase()

  // ===== 会话管理 =====
  ipcMain.handle(IPC.SESSION_CREATE, async (_e, params: SessionCreateParams) => {
    // 校验模型格式 provider/modelId
    if (!resolveModel(params.model)) {
      throw new Error(`无效模型: ${params.model}，格式应为 provider/modelId（如 deepseek/deepseek-v4-pro）`)
    }
    // 校验专家：未指定则用默认专家（通用助手）
    const expert = params.expertId ? expertRegistry!.get(params.expertId) : expertRegistry!.getDefault()
    if (!expert) {
      throw new Error(`无效专家: ${params.expertId}`)
    }
    return createSessionInternal(params)
  })

  ipcMain.handle(IPC.SESSION_SEND, async (_e, { sessionId, message, attachments }: { sessionId: string; message: string; attachments?: AttachmentInput[] }) => {
    if (!agentRuntime) return false
    return agentRuntime.sendMessage(sessionId, message, saveAttachments(sessionId, attachments))
  })

  ipcMain.handle(IPC.SESSION_LIST, async (_e, params?: { filter?: string; search?: string; archived?: boolean }) => {
    const items = db.session.list({ search: params?.search, archived: params?.archived })
    return items.map((s) => ({
      id: s.id,
      title: s.title,
      mode: s.mode,
      status: s.status,
      currentExpert: s.current_expert,
      projectPath: s.project_path,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      model: s.model,
      archived: s.archived === 1,
    }))
  })

  ipcMain.handle(IPC.SESSION_RENAME, async (_e, { sessionId, title }: { sessionId: string; title: string }) => {
    const trimmed = title.trim()
    if (!trimmed) return false
    db.session.rename(sessionId, trimmed)
    return true
  })

  ipcMain.handle(IPC.SESSION_ARCHIVE, async (_e, { sessionId, archived }: { sessionId: string; archived: boolean }) => {
    db.session.setArchived(sessionId, archived)
    return true
  })

  ipcMain.handle(IPC.SESSION_REVEAL, async (_e, { sessionId }: { sessionId: string }) => {
    const s = db.session.get(sessionId)
    if (!s) return false
    const target = s.project_path || s.workspace_path
    if (!existsSync(target)) mkdirSync(target, { recursive: true })
    await shell.openPath(target)
    return true
  })

  ipcMain.handle(IPC.SESSION_MESSAGES, async (_e, { sessionId }: { sessionId: string }) => {
    return db.message.listBySession(sessionId)
  })

  ipcMain.handle(IPC.SESSION_RUNS, async (_e, { sessionId }: { sessionId: string }) => {
    return db.agentRun.listBySession(sessionId)
  })

  // ===== 工作区文件（产物面板） =====
  ipcMain.handle(IPC.WORKSPACE_LIST, async (_e, { sessionId }: { sessionId: string }) => {
    const session = db.session.get(sessionId)
    if (!session) return []
    const budget = { count: 0 }
    return listWorkspaceTree(session.workspace_path, "", 0, budget)
  })

  ipcMain.handle(IPC.WORKSPACE_READ, async (_e, { sessionId, path }: { sessionId: string; path: string }) => {
    const session = db.session.get(sessionId)
    if (!session) throw new Error("会话不存在")
    const abs = assertInWorkspace(session.workspace_path, path)
    const stat = statSync(abs)
    if (!stat.isFile()) throw new Error("不是文件")
    const ext = extname(abs).toLowerCase()
    if (IMAGE_EXTS.has(ext)) {
      const buf = readFileSync(abs)
      return { path, content: null, isImage: true, dataUrl: `data:image/${ext.slice(1)};base64,${buf.toString("base64")}`, size: stat.size } satisfies WorkspaceReadResponse
    }
    if (stat.size > TEXT_SIZE_LIMIT) {
      return { path, content: null, isImage: false, size: stat.size } satisfies WorkspaceReadResponse
    }
    return { path, content: readFileSync(abs, "utf-8"), isImage: false, size: stat.size } satisfies WorkspaceReadResponse
  })

  /** 资料库「文档」数据源：递归收集自由任务 workspace 中产出的 md/html 文档（不扫 project 会话——那是用户自己的项目目录） */
  ipcMain.handle(IPC.WORKSPACE_DOCS_LIST, async (): Promise<WorkspaceDocItem[]> => {
    // archived 语义：true=只看归档，false/undefined=只看未归档 → 两次调用合并全量
    // 仅自由任务：project 会话的 workspace 是用户项目目录，不属于"任务产出文档"
    const sessions = [...db.session.list({ mode: "free" }), ...db.session.list({ mode: "free", archived: true })]
    const docs: WorkspaceDocItem[] = []
    for (const s of sessions) {
      if (!s.workspace_path || !existsSync(s.workspace_path)) continue
      const found: { relPath: string; name: string; mtime: number; size: number }[] = []
      collectDocs(s.workspace_path, "", 0, found, { count: 0 })
      for (const f of found) {
        docs.push({ sessionId: s.id, sessionTitle: s.title, relPath: f.relPath, name: f.name, mtime: f.mtime, size: f.size })
      }
    }
    // 全局限 200：按修改时间倒序（最新产出在前）
    docs.sort((a, b) => b.mtime - a.mtime)
    return docs.slice(0, 200)
  })

  // 消息附件读取（仅 ~/.nexa/uploads 内，渲染端展示缩略图用）
  ipcMain.handle(IPC.ATTACHMENT_READ, async (_e, filePath: string) => {
    return readAttachmentDataUrl(filePath)
  })

  // 产物 HTML 预览静态服务: 127.0.0.1 随机端口，GET /artifact/<sessionId>/<相对路径>
  // iframe 以纯 http 加载，相对路径的 css/js/图片等资源正常解析（自定义协议 iframe 加载不可靠，已弃用）
  const ARTIFACT_MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
  }
  const artifactServer = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const m = url.pathname.match(/^\/artifact\/([^/]+)\/(.+)$/)
      if (req.method !== "GET" || !m) {
        res.writeHead(404).end()
        return
      }
      const sessionId = m[1]
      const rel = decodeURIComponent(m[2])
      const session = db.session.get(sessionId)
      if (!session || !rel) {
        res.writeHead(404).end()
        return
      }
      const abs = assertInWorkspace(session.workspace_path, rel)
      const data = readFileSync(abs)
      console.log(`[artifact-preview] 200 ${sessionId}/${rel}`)
      res.writeHead(200, { "content-type": ARTIFACT_MIME[extname(abs).toLowerCase()] ?? "application/octet-stream" })
      res.end(data)
    } catch (err) {
      console.error("[artifact-preview] 加载失败:", err instanceof Error ? err.message : err)
      res.writeHead(404).end()
    }
  })
  artifactServer.listen(0, "127.0.0.1", () => {
    const addr = artifactServer.address()
    if (addr && typeof addr === "object") {
      artifactPreviewBase = `http://127.0.0.1:${addr.port}`
      console.log(`[artifact-preview] 已启动: ${artifactPreviewBase}`)
    }
  })
  ipcMain.handle(IPC.ARTIFACT_PREVIEW_BASE, () => artifactPreviewBase)

  ipcMain.handle(IPC.SESSION_PAUSE, async (_e, { sessionId }: { sessionId: string }) => {
    return agentRuntime?.pause(sessionId) ?? false
  })

  ipcMain.handle(IPC.SESSION_RESUME, async (_e, { sessionId }: { sessionId: string }) => {
    if (!agentRuntime) return false
    return agentRuntime.resume(sessionId)
  })

  ipcMain.handle(IPC.SESSION_DELETE, async (_e, { sessionId }: { sessionId: string }) => {
    const session = db.session.get(sessionId)
    if (!session) return false

    // 停止 Agent 执行
    agentRuntime?.stop(sessionId)

    // free 模式清理 workspace 目录
    if (session.mode === "free") {
      try {
        const { rmSync } = await import("node:fs")
        rmSync(session.workspace_path, { recursive: true, force: true })
      } catch {
        /* workspace 已不存在或权限不足，忽略 */
      }
    }
    // project 模式不清理 workspace_path（用户的项目代码不能删）

    db.session.delete(sessionId)
    return true
  })

  // ===== 专家 =====
  ipcMain.handle(IPC.EXPERT_LIST, async () => {
    return expertRegistry!.listInfo()
  })

  ipcMain.handle(IPC.SESSION_SET_EXPERT, async (_e, { sessionId, expertId }: { sessionId: string; expertId: string }) => {
    if (!agentRuntime) return false
    return agentRuntime.setExpert(sessionId, expertId)
  })

  ipcMain.handle(IPC.SESSION_SET_MODEL, async (_e, { sessionId, model }: { sessionId: string; model: string }) => {
    if (!agentRuntime) return false
    return agentRuntime.setModel(sessionId, model)
  })

  // ===== Skill =====
  ipcMain.handle(IPC.SKILL_LIST, async () => {
    return skillRegistry!.listInfo()
  })

  ipcMain.handle(IPC.SKILL_TOGGLE, async (_e, { id, enabled }: { id: string; enabled: boolean }) => {
    return skillRegistry!.setEnabled(id, enabled)
  })

  ipcMain.handle(IPC.SKILL_GET, async (_e, id: string) => {
    return skillRegistry!.getDetail(id)
  })

  ipcMain.handle(IPC.SKILL_SAVE, async (_e, { id, yaml }: { id: string; yaml: string }) => {
    skillRegistry!.saveYaml(id, yaml)
    return true
  })

  ipcMain.handle(IPC.SKILL_DELETE, async (_e, id: string) => {
    return skillRegistry!.remove(id)
  })

  // ===== 连接器 =====
  ipcMain.handle(IPC.CONNECTOR_LIST, async () => {
    return connectorManager!.list().map(({ headers: _h, secrets: _s, yamlPath: _p, ...info }) => info)
  })

  ipcMain.handle(IPC.CONNECTOR_TEST, async (_e, id: string) => {
    return connectorManager!.healthCheck(id)
  })

  ipcMain.handle(IPC.CONNECTOR_GET, async (_e, id: string) => {
    return connectorManager!.getDetail(id)
  })

  ipcMain.handle(IPC.CONNECTOR_SAVE, async (_e, { id, yaml, previousId }: { id: string; yaml: string; previousId?: string }) => {
    return connectorManager!.saveYaml(id, yaml, previousId)
  })

  ipcMain.handle(IPC.CONNECTOR_DELETE, async (_e, id: string) => {
    return connectorManager!.deleteYaml(id)
  })

  // ===== 专家管理 =====
  ipcMain.handle(IPC.EXPERT_GET, async (_e, id: string) => {
    return expertRegistry!.getDetail(id)
  })

  ipcMain.handle(IPC.EXPERT_SAVE, async (_e, params: ExpertSaveParams) => {
    return expertRegistry!.save(params)
  })

  ipcMain.handle(IPC.EXPERT_DELETE, async (_e, id: string) => {
    return expertRegistry!.delete(id)
  })

  // ===== 笔记管理 =====
  ipcMain.handle(IPC.NOTE_LIST, async (_e, params?: { category?: string; status?: string; search?: string }) => {
    const list = db.note.list({
      category: params?.category,
      status: params?.status as "draft" | "submitted" | undefined,
      search: params?.search,
    })
    // 渲染端按 { notes, total } 解析，返回数组会导致列表永远为空
    return { notes: list, total: list.length }
  })

  ipcMain.handle(IPC.NOTE_GET, async (_e, id: string) => {
    return db.note.get(id)
  })

  ipcMain.handle(IPC.NOTE_CREATE, async (_e, params: { title: string; content?: string; status?: string; category?: string; tags?: string[] }) => {
    return db.note.create({
      id: randomUUID(),
      title: params.title,
      content: params.content,
      status: params.status as "draft" | "submitted" | undefined,
      category: params.category,
      tags: params.tags,
    })
  })

  ipcMain.handle(IPC.NOTE_UPDATE, async (_e, id: string, patch: { title?: string; content?: string; status?: "draft" | "submitted"; category?: string; tags?: string[] }) => {
    return db.note.update(id, patch)
  })

  ipcMain.handle(IPC.NOTE_DELETE, async (_e, id: string) => {
    db.note.delete(id)
    return true
  })

  ipcMain.handle(IPC.NOTE_CATEGORIES, async () => {
    return db.noteCategory.listWithCount()
  })

  ipcMain.handle(IPC.NOTE_ADD_CATEGORY, async (_e, params: { name: string; icon?: string }) => {
    return db.noteCategory.create(params.name, params.icon)
  })

  ipcMain.handle(IPC.NOTE_REMOVE_CATEGORY, async (_e, id: string) => {
    db.noteCategory.remove(id)
    return true
  })

  // ===== 知识库 (M4) =====
  ipcMain.handle(IPC.KB_LIST, async (_e, opts: { type?: string; limit?: number }) => {
    return db.knowledge.list({ type: opts.type as KnowledgeItem["type"], limit: opts.limit })
  })

  ipcMain.handle(IPC.KB_GET, async (_e, id: string) => {
    return db.knowledge.get(id)
  })

  ipcMain.handle(IPC.KB_SEARCH, async (_e, params: { query: string; type?: string; topN?: number }) => {
    if (!knowledgeBase) throw new Error("知识库服务未初始化")
    return knowledgeBase.search({
      query: params.query,
      type: params.type as KnowledgeItem["type"],
      topN: params.topN ?? 5,
    })
  })

  ipcMain.handle(IPC.KB_ADD_NOTE, async (_e, params: { title?: string; content: string; workspaceId?: string | null }) => {
    if (!knowledgeBase) throw new Error("知识库服务未初始化")
    const item = await knowledgeBase.ingestNote(params)
    void memoryEngine?.onKnowledgeItemCreated(item).catch(() => {})
    return item
  })

  ipcMain.handle(IPC.KB_ADD_ARTICLE, async (_e, params: { url: string; html?: string; title?: string; workspaceId?: string | null }) => {
    if (!knowledgeBase) throw new Error("知识库服务未初始化")
    const item = await knowledgeBase.ingestArticle(params)
    if (item) void memoryEngine?.onKnowledgeItemCreated(item).catch(() => {})
    return item
  })

  ipcMain.handle(IPC.KB_ADD_IMAGE, async (_e, params: { filePath: string; title?: string; description?: string; workspaceId?: string | null }) => {
    if (!knowledgeBase) throw new Error("知识库服务未初始化")
    const item = await knowledgeBase.ingestImage(params)
    void memoryEngine?.onKnowledgeItemCreated(item).catch(() => {})
    return item
  })

  ipcMain.handle(IPC.KB_ADD_DOC, async (_e, params: { title?: string; content: string; workspaceId?: string | null }) => {
    if (!knowledgeBase) throw new Error("知识库服务未初始化")
    const item = await knowledgeBase.ingestDoc(params)
    void memoryEngine?.onKnowledgeItemCreated(item).catch(() => {})
    return item
  })

  ipcMain.handle(IPC.KB_DELETE, async (_e, id: string) => {
    db.knowledge.delete(id)
    return true
  })

  // 知识库图片原图（按条目 id 取 file_path，仅图片类型；不接受渲染端传路径，避免任意文件读取）
  ipcMain.handle(IPC.KB_IMAGE_READ, async (_e, id: string) => {
    const item = db.knowledge.get(id)
    if (!item || item.type !== "image" || !item.file_path) return null
    if (!existsSync(item.file_path)) return null
    const ext = extname(item.file_path).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) return null
    try {
      const buf = readFileSync(item.file_path)
      return `data:image/${ext.slice(1)};base64,${buf.toString("base64")}`
    } catch {
      return null
    }
  })

  // ===== 记忆 (M4) =====
  ipcMain.handle(IPC.MEMORY_LIST, async (_e, filter: { layer?: string; minConfidence?: number }) => {
    return db.memory.list({ layer: filter.layer as MemoryItem["layer"], minConfidence: filter.minConfidence })
  })

  ipcMain.handle(IPC.MEMORY_UPSERT, async (_e, item: { layer: string; category: string; content: string; confidence?: number }) => {
    return db.memory.upsert({
      layer: item.layer as MemoryItem["layer"],
      category: item.category.slice(0, 40),
      content: item.content.slice(0, 500),
      confidence: item.confidence ?? 0.9,
      source_session: null,
    })
  })

  ipcMain.handle(IPC.MEMORY_UPDATE, async (_e, id: string, patch: { content?: string; confidence?: number; category?: string; layer?: string }) => {
    return db.memory.update(id, {
      content: patch.content,
      confidence: patch.confidence,
      category: patch.category,
      layer: patch.layer as MemoryItem["layer"],
    })
  })

  ipcMain.handle(IPC.MEMORY_DELETE, async (_e, id: string) => {
    db.memory.delete(id)
    return true
  })

  // ===== 定时任务 (M5) =====
  ipcMain.handle(IPC.JOB_LIST, async () => {
    // 附带每个任务的执行次数与最近一次成败
    return db.scheduledJob.listAll().map((j) => {
      const latest = db.jobRun.listByJob(j.id, 1)[0]
      return { ...j, runCount: db.jobRun.countByJob(j.id), lastSuccess: latest ? latest.success : null }
    })
  })

  ipcMain.handle(IPC.JOB_TOGGLE, async (_e, params: { id: string; enabled: boolean }) => {
    const job = db.scheduledJob.get(params.id)
    if (!job) return false
    const nextRun = params.enabled ? computeNextRunSeconds(job.cron_expr) : null
    db.scheduledJob.setEnabled(params.id, params.enabled ? 1 : 0, nextRun)
    return true
  })

  ipcMain.handle(IPC.JOB_DELETE, async (_e, id: string) => {
    db.scheduledJob.delete(id)
    return true
  })

  ipcMain.handle(IPC.JOB_RUN_NOW, async (_e, id: string) => {
    if (!scheduler) throw new Error("调度器未初始化")
    await scheduler.runNow(id)
    return true
  })

  ipcMain.handle(IPC.JOB_RUNS, async (_e, params?: { limit?: number; offset?: number }) => {
    // 参数来自渲染进程，统一归一为安全数字（undefined/NaN 直接进 sql.js bind 会抛错）
    const limit = Math.min(Math.max(Math.floor(Number(params?.limit)) || 30, 1), 200)
    const offset = Math.max(Math.floor(Number(params?.offset)) || 0, 0)
    return db.jobRun.listAll(limit, offset)
  })

  ipcMain.handle(IPC.JOB_STATS, async () => {
    return {
      activeCount: db.scheduledJob.listEnabled().length,
      todayCount: db.jobRun.countToday(),
      totalCount: db.jobRun.countAll(),
    }
  })

  // ===== 手机中继 (M5b) =====
  ipcMain.handle(IPC.RELAY_STATUS, async () => {
    return relayClient?.getStatus() ?? null
  })

  ipcMain.handle(IPC.RELAY_SET_URL, async (_e, url: string) => {
    const next = (url ?? "").trim()
    if (next && !/^https?:\/\/.+/.test(next)) {
      throw new Error("中继地址需以 http:// 或 https:// 开头")
    }
    saveSettings({ relayUrl: next })
    relayClient?.configure(next)
    return true
  })

  ipcMain.handle(IPC.RELAY_CREATE_PAIRING, async () => {
    if (!relayClient) throw new Error("中继客户端未初始化")
    return relayClient.requestPairing()
  })

  ipcMain.handle(IPC.RELAY_UNBIND, async (_e, deviceId: string) => {
    await relayClient?.unbind(deviceId)
    return true
  })

  ipcMain.handle(IPC.RELAY_RENAME, async (_e, deviceId: string, name: string) => {
    if (!relayClient) throw new Error("中继客户端未初始化")
    relayClient.rename(deviceId, name)
    return true
  })

  // ===== 目录选择器 =====
  ipcMain.handle(IPC.OPEN_DIRECTORY_PICKER, async () => {
    const { dialog } = await import("electron")
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ===== 主题 =====
  ipcMain.handle(IPC.GET_THEME, () => {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light"
  })

  ipcMain.handle(IPC.SET_THEME, (_e, theme: "light" | "dark" | "system") => {
    nativeTheme.themeSource = theme
    return true
  })

  // ===== 设置 =====
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    const s = loadSettings()
    return {
      defaultModel: s.defaultModel || "deepseek/deepseek-v4-flash",
      availableModels: [
        { id: "deepseek/deepseek-v4-flash", displayName: "DeepSeek V4 Flash", provider: "deepseek", modelId: "deepseek-v4-flash" },
        { id: "deepseek/deepseek-v4-pro", displayName: "DeepSeek V4 Pro", provider: "deepseek", modelId: "deepseek-v4-pro" },
        { id: "deepseek/deepseek-v3.2", displayName: "DeepSeek V3.2", provider: "deepseek", modelId: "deepseek-v3.2" },
        { id: "openai/gpt-4o", displayName: "GPT-4o", provider: "openai", modelId: "gpt-4o" },
        { id: "openai/gpt-4o-mini", displayName: "GPT-4o mini", provider: "openai", modelId: "gpt-4o-mini" },
        { id: "anthropic/claude-3-5-sonnet", displayName: "Claude 3.5 Sonnet", provider: "anthropic", modelId: "claude-3-5-sonnet" },
        { id: "anthropic/claude-3-5-haiku", displayName: "Claude 3.5 Haiku", provider: "anthropic", modelId: "claude-3-5-haiku" },
        // supportsImage: 由 pi-ai 模型定义推导（DeepSeek V4 为 ["text"]，无视觉能力）
      ].map((m) => ({ ...m, supportsImage: Boolean(resolveModel(m.id)?.input.includes("image")) })),
      apiKeys: s.apiKeys,
      baseUrls: s.baseUrls,
      enabledProviders: s.enabledProviders,
      // 实际可用的 provider：显式启用 + 有 key（settings.json 或环境变量回落），与发送时 getApiKey 判断一致
      usableProviders: (["deepseek", "openai", "anthropic"] as const).filter((p) => getApiKey(p) !== undefined),
      initialized: s.initialized,
      userName: s.userName,
      theme: s.theme,
      chatFontSize: s.chatFontSize,
      notificationSound: s.notificationSound || "灵动",
      scheduledNoticeEnabled: s.scheduledNoticeEnabled !== false,
      hiddenProjectPaths: s.hiddenProjectPaths ?? [],
    }
  })

  ipcMain.handle(IPC.SET_SETTINGS, (_e, update: Partial<{ defaultModel: string; apiKeys: Record<string, string>; baseUrls: Record<string, string>; enabledProviders: Record<string, boolean>; initialized: boolean; userName: string; theme: "system" | "light" | "dark"; chatFontSize: 12 | 14 | 16; notificationSound: string; scheduledNoticeEnabled: boolean; hiddenProjectPaths: string[] }>) => {
    return saveSettings(update)
  })

  // ===== 通知设置 =====
  // 打开 macOS 系统「通知」面板（Ventura+ 用 Settings 扩展，失败回落旧 prefPane 路径）
  ipcMain.handle(IPC.OPEN_NOTIFICATION_SETTINGS, async () => {
    if (process.platform !== "darwin") return false
    try {
      await shell.openExternal("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
    } catch {
      await shell.openPath("/System/Library/PreferencePanes/Notifications.prefPane")
    }
    return true
  })

  // ===== 文件系统 =====
  /** 在 Finder / Explorer 中打开任意绝对路径（主进程 shell.openPath） */
  ipcMain.handle(IPC.OPEN_FOLDER, async (_e, path: string) => {
    if (!path || typeof path !== "string") return false
    try {
      await shell.openPath(path)
      return true
    } catch (err) {
      flog(`OPEN_FOLDER failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  })
}

/** 文件日志（Electron 主进程 console 输出在后台时不可见） */
const LOG_FILE = join(homedir(), ".nexa", "main.log")
function flog(msg: string): void {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

app.whenReady().then(async () => {
    // 没拿到单实例锁的进程不做任何初始化（app.quit() 在 ready 前不保证立刻生效，这里兜底）
    if (!gotSingleInstanceLock) return
    flog("whenReady resolved")
    try {
      flog("initializing database...")
      await initDatabase()
      flog("database initialized")
      expertRegistry = new ExpertRegistry()
      skillRegistry = new SkillRegistry()
      connectorManager = new ConnectorManager()
      knowledgeBase = new KnowledgeBaseService(getDatabase())
      memoryEngine = new MemoryEngine(getDatabase())
      agentRuntime = new AgentRuntime(getDatabase(), sendAgentEvent, expertRegistry, skillRegistry, connectorManager, knowledgeBase, memoryEngine)

      // 手机中继客户端 (M5b)
      relayClient = new RelayClient(
        {
          createTask: async (prompt, model, attachments) => {
            const useModel = model?.trim() || loadSettings().defaultModel
            if (!useModel || !resolveModel(useModel)) {
              throw new Error("桌面端未配置默认模型，请先在 Nexa 设置中选择模型")
            }
            return createSessionInternal({ initialMessage: prompt, mode: "free", model: useModel, attachments })
          },
          sendMessage: async (sessionId, message, attachments) =>
            agentRuntime!.sendMessage(sessionId, message, saveAttachments(sessionId, attachments ?? [])),
          pauseSession: async (sessionId) => agentRuntime!.pause(sessionId),
          resumeSession: async (sessionId) => agentRuntime!.resume(sessionId),
          listSessions: async () => {
            // 未归档 + 归档合并：手机端任务页需要同时展示两类（archived 字段由渲染端分组）
            const db = getDatabase()
            return [...db.session.list({}), ...db.session.list({ archived: true })].map((s) => ({
              id: s.id,
              title: s.title,
              mode: s.mode,
              status: s.status,
              currentExpert: s.current_expert,
              projectPath: s.project_path,
              createdAt: s.created_at,
              updatedAt: s.updated_at,
              model: s.model,
              archived: s.archived === 1,
            }))
          },
          listMessages: async (sessionId) =>
            // 手机端无法访问桌面本地路径：图片附件读成 dataUrl 随消息下发；
            // 单张 >2.5MB 的跳过（dataUrl=null），防止整表回包超中继 4MB 上限
            getDatabase().message.listBySession(sessionId).map((m) => ({
              ...m,
              // 手机端按 runId 关联 agent_runs（任务耗时/工具次数）
              runId: m.run_id,
              // 手机端消息底栏展示：时间 / 模型 / token 用量（字段名对齐 ChatMessage）
              createdAt: m.created_at,
              usage: m.token_usage,
              attachments: (m.attachments ?? []).map((a) => ({
                name: a.name,
                mimeType: a.mimeType,
                dataUrl: (a.size ?? 0) <= 2.5 * 1024 * 1024 ? readAttachmentDataUrl(a.path) : null,
              })),
            })),
          // 手机端任务详情：产物文档列表（与桌面端产物面板同源，仅自由任务 workspace）
          sessionArtifacts: async (sessionId) => {
            const session = getDatabase().session.get(sessionId)
            if (!session?.workspace_path || !existsSync(session.workspace_path)) return []
            const found: { relPath: string; name: string; mtime: number; size: number }[] = []
            collectDocs(session.workspace_path, "", 0, found, { count: 0 })
            return found.sort((a, b) => b.mtime - a.mtime).slice(0, 30)
          },
          // 手机端产物预览：md/html 返回文本，其他类型返回大小占位
          artifactRead: async (sessionId, relPath) => {
            const session = getDatabase().session.get(sessionId)
            if (!session?.workspace_path) throw new Error("会话不存在")
            const abs = assertInWorkspace(session.workspace_path, relPath)
            const stat = statSync(abs)
            if (!stat.isFile()) throw new Error("不是文件")
            if (stat.size > TEXT_SIZE_LIMIT) return { path: relPath, content: null, size: stat.size }
            return { path: relPath, content: readFileSync(abs, "utf-8"), size: stat.size }
          },
          // 手机端任务轨迹：agent_runs（任务耗时 / 工具调用次数 / 状态）
          sessionRuns: async (sessionId) => getDatabase().agentRun.listBySession(sessionId),
          // 浏览器插件（M6）
          ingestArticle: async ({ url, html, text, title }) => {
            if (!knowledgeBase) throw new Error("知识库未初始化")
            const item = await knowledgeBase.ingestArticle({ url, html, text, title })
            if (!item) return { ok: true, duplicate: true, title }
            return { ok: true, id: item.id, title: item.title }
          },
          favoriteImage: async ({ url, data, mimeType, title, description }) => {
            if (!knowledgeBase) throw new Error("知识库未初始化")
            const ext = (mimeType && mimeType.split("/")[1]) || extname(url).slice(1) || "png"
            const id = `kb-${randomUUID()}`
            const dir = join(homedir(), ".nexa", "library", "images")
            mkdirSync(dir, { recursive: true })
            const filePath = join(dir, `${id}.${ext}`)
            const buf = Buffer.from(data, "base64")
            writeFileSync(filePath, buf)
            const item = await knowledgeBase.ingestImage({
              filePath,
              title: title || url.split("/").pop() || "图片",
              description: description || `来自 ${url}`,
            })
            return { ok: true, id: item.id }
          },
          searchLibrary: async (query) => {
            if (!knowledgeBase) throw new Error("知识库未初始化")
            const items = await knowledgeBase.search({ query, topN: 8 })
            return items.map((i) => ({ id: i.id, title: i.title, summary: i.summary, type: i.type }))
          },
          // 笔记管理（浏览器插件笔记页）
          noteList: async (params) => {
            const list = getDatabase().note.list({
              category: params?.category,
              search: params?.search,
            })
            return { notes: list, total: list.length }
          },
          noteGet: async (id) => getDatabase().note.get(id),
          noteCreate: async (params) =>
            getDatabase().note.create({
              id: randomUUID(),
              title: params.title,
              content: params.content,
              category: params.category,
            }),
          noteUpdate: async (id, patch) => getDatabase().note.update(id, patch),
          noteDelete: async (id) => {
            getDatabase().note.delete(id)
            return { ok: true }
          },
          noteCategories: async () => getDatabase().noteCategory.listWithCount(),
          // 手机端定时任务页
          scheduleList: async () => getDatabase().scheduledJob.listAll(),
          scheduleRuns: async (jobId, limit) => getDatabase().jobRun.listByJob(jobId, limit ?? 50),
          // 手机端资料页：知识库条目（文章/图片/文档）列表与详情
          libraryList: async () => ({ items: getDatabase().knowledge.list({ limit: 200 }) }),
          libraryGet: async (id) => {
            const item = getDatabase().knowledge.get(id)
            if (!item) return null
            // 正文存放在 file_path 文件中（图片除外），读取后一并下发
            let content: string | null = null
            let dataUrl: string | null = null
            if (item.type === "image" && item.file_path && existsSync(item.file_path)) {
              // 图片：读原图转 dataURL 下发，手机端直接渲染
              const ext = extname(item.file_path).toLowerCase()
              if (IMAGE_EXTS.has(ext)) {
                try {
                  const buf = readFileSync(item.file_path)
                  dataUrl = `data:image/${ext.slice(1)};base64,${buf.toString("base64")}`
                } catch {
                  dataUrl = null
                }
              }
            } else if (item.type !== "image" && item.file_path && existsSync(item.file_path)) {
              try {
                content = readFileSync(item.file_path, "utf-8")
              } catch {
                content = null
              }
            }
            return { ...item, content, dataUrl }
          },
        },
        (status) => {
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send(RELAY_EVENT, status)
          }
        },
      )
      relayClient.start(loadSettings().relayUrl)
      flog("relay client started")

      // 定时任务调度器 (M5)
      const jobsDir = join(homedir(), ".nexa", "jobs")
      mkdirSync(jobsDir, { recursive: true })
      scheduler = new SchedulerService(
        getDatabase(),
        {
          runScript: (scriptPath, args) => runNodeScript(scriptPath, args),
          runSkill: async (skillName, inputs) => {
            const skill = skillRegistry!.getRunnable(skillName)
            if (!skill) throw new Error(`Skill "${skillName}" 不存在或已被禁用`)
            const result = await runSkill(skill, inputs, jobsDir)
            if (!result.ok) throw new Error(result.error || result.message || "Skill 执行失败")
            return `${result.message}${result.files?.length ? `\n产出文件: ${result.files.join(", ")}` : ""}`
          },
          continueSession: (sessionId, prompt) => agentRuntime!.continueSessionAsync(sessionId, prompt),
          // 目标会话被删除时重建空会话（不启动 Loop，随后由 continueSession 续跑）
          recreateSession: (description) => {
            const db = getDatabase()
            const id = randomUUID()
            const wsPath = ensureWorkspaceDir("free", id, undefined)
            const expert = expertRegistry!.getDefault()
            const session = db.session.create({
              id,
              title: normalizeTitle(description, 30) || "定时任务会话",
              mode: "free",
              workspace_path: wsPath,
              project_path: null,
              model: loadSettings().defaultModel,
              current_expert: expert?.id ?? null,
            })
            flog(`定时任务目标会话已被删除，自动重建: ${session.id}`)
            return session.id
          },
        },
        (payload) => {
          // 定时任务产物生成的桌面通知（设置页可关闭）
          if (loadSettings().scheduledNoticeEnabled !== false) {
            showDesktopNotice(
              payload.success ? `定时任务完成：${payload.description}` : `定时任务失败：${payload.description}`,
              payload.output.slice(0, 200),
            )
          }
          // 手机推送（M5b）
          relayClient?.forwardSchedulerNotify(payload)
        },
      )
      agentRuntime.setSchedulerRunner((jobId) => scheduler!.runNow(jobId))
      scheduler.start()
      flog("scheduler started")

      registerIpcHandlers()
      flog("IPC handlers registered")
    } catch (err) {
      flog("Failed to register IPC handlers: " + (err instanceof Error ? err.message : String(err)))
    }
  try {
    createWindow()
    flog("Window created")
  } catch (err) {
    flog("Failed to create window: " + (err instanceof Error ? err.message : String(err)))
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// @ts-expect-error Electron 的类型定义不包含这些事件
app.on("uncaughtException", (err: Error) => {
  console.error("[main] uncaughtException:", err)
})
// @ts-expect-error Electron 的类型定义不包含这些事件
app.on("unhandledRejection", (reason: unknown) => {
  console.error("[main] unhandledRejection:", reason)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", () => {
  relayClient?.shutdown()
})
