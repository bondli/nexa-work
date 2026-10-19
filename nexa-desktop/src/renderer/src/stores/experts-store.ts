/**
 * 专家状态 —— 专家列表 + 新会话默认选中专家
 */
import { create } from "zustand"
import type { ExpertInfo } from "@shared/ipc-channels"

interface ExpertsState {
  experts: ExpertInfo[]
  /** 新会话默认使用的专家 id */
  currentExpertId: string
  fetchExperts: () => Promise<void>
  setCurrentExpert: (id: string) => void
}

export const useExpertsStore = create<ExpertsState>((set) => ({
  experts: [],
  currentExpertId: "builtin:general",

  fetchExperts: async () => {
    if (typeof window === "undefined" || !window.nexa) return
    try {
      const experts = (await window.nexa.expertList()) as ExpertInfo[]
      set({ experts })
    } catch {
      // 拉取失败保持空列表，选择器降级隐藏
    }
  },

  setCurrentExpert: (id) => set({ currentExpertId: id }),
}))
