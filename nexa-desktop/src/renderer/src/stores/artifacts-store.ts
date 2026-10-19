import { create } from "zustand"
import type { WorkspaceFileNode, WorkspaceReadResponse } from "@shared/ipc-channels"

/**
 * 产物面板 Store —— 右侧文件树 + 预览
 * 由 conversation-store 在 selectSession / tool.result 时联动刷新
 */
interface ArtifactsState {
  /** 面板是否展开（默认展开） */
  panelOpen: boolean
  /** 是否最大化（抽屉延展到左侧导航栏旁，铺满整个任务页） */
  maximized: boolean
  /** 仅预览模式: 隐藏文件树，整个抽屉只显示当前文件（消息内文件卡点击进入） */
  previewOnly: boolean
  /** 当前加载文件树的会话 */
  sessionId: string | null
  tree: WorkspaceFileNode[]
  /** 展开的目录路径集合 */
  expanded: Set<string>
  /** 当前预览的文件相对路径 */
  selectedPath: string | null
  readResult: WorkspaceReadResponse | null
  loading: boolean
  /** 产物 HTML 预览静态服务地址（http://127.0.0.1:<port>，懒加载一次） */
  previewBase: string | null

  setPanelOpen: (open: boolean) => void
  /** 切换最大化/还原 */
  toggleMaximized: () => void
  /** 切换仅预览/完整模式 */
  setPreviewOnly: (v: boolean) => void
  /** 懒加载预览服务地址 */
  ensurePreviewBase: () => Promise<void>
  /** 加载/重载指定会话的文件树（sessionId 相同也强制刷新） */
  fetchTree: (sessionId: string) => Promise<void>
  /** 仅当 sessionId 是当前会话时刷新（tool.result 联动用） */
  refreshIfCurrent: (sessionId: string) => void
  toggleDir: (path: string) => void
  selectFile: (path: string) => Promise<void>
  /** 消息内文件卡直达: 展开面板 + 展开父目录 + 选中预览 */
  openArtifact: (sessionId: string, path: string) => Promise<void>
  clear: () => void
}

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  panelOpen: false,
  maximized: false,
  previewOnly: false,
  sessionId: null,
  tree: [],
  expanded: new Set(),
  selectedPath: null,
  readResult: null,
  loading: false,
  previewBase: null,

  setPanelOpen: (open) => set({ panelOpen: open }),

  toggleMaximized: () => set((s) => ({ maximized: !s.maximized })),

  setPreviewOnly: (v) => set({ previewOnly: v }),

  ensurePreviewBase: async () => {
    if (get().previewBase || typeof window === "undefined" || !window.nexa) return
    try {
      const base = (await window.nexa.getArtifactPreviewBase()) as string
      if (base) set({ previewBase: base })
    } catch {
      /* 主进程未就绪时静默，下次重试 */
    }
  },

  fetchTree: async (sessionId) => {
    if (typeof window === "undefined" || !window.nexa) return
    set({ loading: true, sessionId })
    try {
      const tree = (await window.nexa.workspaceList(sessionId)) as WorkspaceFileNode[]
      // 会话可能已切换，丢弃过期结果
      if (get().sessionId !== sessionId) return
      set({ tree })
    } catch {
      if (get().sessionId === sessionId) set({ tree: [] })
    } finally {
      if (get().sessionId === sessionId) set({ loading: false })
    }
  },

  refreshIfCurrent: (sessionId) => {
    if (get().sessionId === sessionId && get().panelOpen) {
      void get().fetchTree(sessionId)
    }
  },

  toggleDir: (path) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(path)) expanded.delete(path)
    else expanded.add(path)
    set({ expanded })
  },

  selectFile: async (path) => {
    const sessionId = get().sessionId
    if (!sessionId || typeof window === "undefined" || !window.nexa) return
    set({ selectedPath: path, readResult: null })
    try {
      const res = (await window.nexa.workspaceRead(sessionId, path)) as WorkspaceReadResponse
      if (get().sessionId === sessionId && get().selectedPath === path) {
        set({ readResult: res })
      }
    } catch {
      if (get().sessionId === sessionId && get().selectedPath === path) {
        set({ readResult: { path, content: null, isImage: false, size: 0 } })
      }
    }
  },

  openArtifact: async (sessionId, path) => {
    if (typeof window === "undefined" || !window.nexa) return
    // 文件卡直达: 仅预览模式（不出文件树），展开面板 + 选中预览
    set({ previewOnly: true })
    void get().ensurePreviewBase()
    if (get().sessionId !== sessionId) {
      await get().fetchTree(sessionId)
    }
    set({ panelOpen: true })
    await get().selectFile(path)
  },

  clear: () =>
    set({
      sessionId: null,
      tree: [],
      expanded: new Set(),
      selectedPath: null,
      readResult: null,
      loading: false,
    }),
}))
