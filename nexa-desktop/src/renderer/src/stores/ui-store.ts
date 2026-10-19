import { create } from "zustand"

/** 主区域视图 */
export type ActiveView = "chat" | "skill-packs" | "scheduled" | "library"

/** 全局 UI 状态 —— 视图切换、对话框、弹窗等跨组件状态 */
interface UiState {
  /** 当前主区域视图 */
  activeView: ActiveView
  /** 设置弹框是否打开 */
  settingsOpen: boolean

  setActiveView: (view: ActiveView) => void
  setSettingsOpen: (open: boolean) => void
}

export const useSettingsOpen = create<UiState>((set) => ({
  activeView: "chat",
  settingsOpen: false,

  setActiveView: (view) => set({ activeView: view }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}))
