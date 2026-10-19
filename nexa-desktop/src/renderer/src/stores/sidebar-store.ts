import { create } from "zustand"
import type { SessionStatus } from "@shared/ipc-channels"

/** 任务列表面板的搜索/筛选面板、任务列表展开组（导航栏无折叠态，面板常驻 chat 视图左侧） */
interface SidebarState {
  /** 搜索面板是否打开 */
  searchOpen: boolean
  /** 筛选面板是否打开 */
  filterOpen: boolean
  /** 搜索关键词 */
  searchQuery: string
  /** 展开的项目分组 ID 集合（含归档分组 "__archived__"） */
  expandedGroups: Set<string>
  /** 筛选：包含的会话状态（空 = 显示全部） */
  filterStatuses: Set<SessionStatus>

  toggleSearch: () => void
  toggleFilter: () => void
  setSearch: (q: string) => void
  toggleGroup: (id: string) => void
  expandGroup: (id: string) => void
  /** 切换某个状态的筛选 */
  toggleFilterStatus: (status: SessionStatus) => void
  /** 清空筛选 */
  clearFilter: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  searchOpen: false,
  filterOpen: false,
  searchQuery: "",
  expandedGroups: new Set(),
  filterStatuses: new Set(),

  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen, filterOpen: false })),
  toggleFilter: () => set((s) => ({ filterOpen: !s.filterOpen, searchOpen: false })),
  setSearch: (q) => set({ searchQuery: q }),
  toggleGroup: (id) =>
    set((s) => {
      const next = new Set(s.expandedGroups)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedGroups: next }
    }),
  expandGroup: (id) =>
    set((s) => {
      const next = new Set(s.expandedGroups)
      next.add(id)
      return { expandedGroups: next }
    }),
  toggleFilterStatus: (status) =>
    set((s) => {
      const next = new Set(s.filterStatuses)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return { filterStatuses: next }
    }),
  clearFilter: () => set({ filterStatuses: new Set() }),
}))
