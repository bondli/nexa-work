/**
 * 外观状态: 应用启动时从 settings 读取，设置弹框切换后立即应用并持久化
 * 覆盖主题（跟随系统/亮色/暗黑）与会话内容字号（12/14/16px）
 */
import { create } from "zustand"
import { applyTheme, applyChatFontSize, type ThemePref, type ChatFontSize } from "@renderer/lib/theme"

interface ThemeStore {
  theme: ThemePref
  /** 会话内容字号（px），默认 14 */
  chatFontSize: ChatFontSize
  /** 启动时从 settings 初始化（默认 dark，与 index.html 硬编码一致避免闪烁） */
  init: () => Promise<void>
  /** 切换主题: 立即应用 + 写入 settings.json */
  setTheme: (pref: ThemePref) => void
  /** 切换会话字号: 立即应用 + 写入 settings.json */
  setChatFontSize: (px: ChatFontSize) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: "dark",
  chatFontSize: 14,

  init: async () => {
    try {
      const s = (await window.nexa.getSettings()) as { theme?: ThemePref; chatFontSize?: ChatFontSize }
      const pref = s.theme ?? "dark"
      const fontSize = (s.chatFontSize === 12 || s.chatFontSize === 16 ? s.chatFontSize : 14) as ChatFontSize
      applyTheme(pref)
      applyChatFontSize(fontSize)
      set({ theme: pref, chatFontSize: fontSize })
    } catch {
      /* 保持默认 dark / 14px */
    }
  },

  setTheme: (pref) => {
    applyTheme(pref)
    set({ theme: pref })
    void window.nexa.setSettings({ theme: pref })
  },

  setChatFontSize: (px) => {
    applyChatFontSize(px)
    set({ chatFontSize: px })
    void window.nexa.setSettings({ chatFontSize: px })
  },
}))
