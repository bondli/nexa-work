/**
 * 主题系统：跟随系统 / 暗黑 / 亮色
 * mode 持久化（SecureStore），实际配色随系统外观联动（mode=system 时）
 */
import { createContext, useContext } from "react"
import { useColorScheme } from "react-native"
import { create } from "zustand"
import * as SecureStore from "expo-secure-store"

export type ThemeMode = "system" | "dark" | "light"

const KEY_THEME = "nexa.theme.mode"

export interface ThemeColors {
  /** 页面/导航底色 */
  bg: string
  /** 卡片底色 */
  card: string
  /** 分隔线/描边 */
  border: string
  /** 主文字 */
  text: string
  /** 次要文字 */
  textSecondary: string
  /** 弱化文字（时间戳/提示） */
  textMuted: string
  /** 强调色（品牌蓝） */
  accent: string
  /** 强调色浅底（按钮/徽章背景） */
  accentSoft: string
  /** 在线绿 */
  online: string
  /** 离线灰点 */
  offline: string
  /** 危险/错误 */
  danger: string
  dangerSoft: string
  /** 成功 */
  success: string
  successSoft: string
  /** 输入框/弱化块底色 */
  subtle: string
  /** 用户气泡 */
  bubbleUser: string
  bubbleUserText: string
  /** 编码任务徽章（紫） */
  badgeCode: string
  badgeCodeSoft: string
}

export const palettes: Record<"dark" | "light", ThemeColors> = {
  dark: {
    bg: "#0a0a0a",
    card: "#171717",
    border: "#262626",
    text: "#fafafa",
    textSecondary: "#a3a3a3",
    textMuted: "#737373",
    accent: "#3b82f6",
    accentSoft: "rgba(59,130,246,0.15)",
    online: "#22c55e",
    offline: "#737373",
    danger: "#f87171",
    dangerSoft: "rgba(248,113,113,0.12)",
    success: "#4ade80",
    successSoft: "rgba(74,222,128,0.12)",
    subtle: "#0f0f0f",
    bubbleUser: "#3b82f6",
    bubbleUserText: "#ffffff",
    badgeCode: "#a78bfa",
    badgeCodeSoft: "rgba(167,139,250,0.14)",
  },
  light: {
    bg: "#f5f5f5",
    card: "#ffffff",
    border: "#e5e5e5",
    text: "#171717",
    textSecondary: "#525252",
    textMuted: "#8a8a8a",
    accent: "#2563eb",
    accentSoft: "rgba(37,99,235,0.10)",
    online: "#16a34a",
    offline: "#a3a3a3",
    danger: "#dc2626",
    dangerSoft: "rgba(220,38,38,0.08)",
    success: "#16a34a",
    successSoft: "rgba(22,163,74,0.10)",
    subtle: "#fafafa",
    bubbleUser: "#2563eb",
    bubbleUserText: "#ffffff",
    badgeCode: "#7c3aed",
    badgeCodeSoft: "rgba(124,58,237,0.10)",
  },
}

interface ThemeModeState {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}

/** 主题模式 store（持久化） */
export const useThemeMode = create<ThemeModeState>((set) => ({
  mode: "system",
  setMode: (m) => {
    set({ mode: m })
    void SecureStore.setItemAsync(KEY_THEME, m)
  },
}))

/** 启动时恢复持久化的主题模式 */
export async function initThemeMode(): Promise<void> {
  const raw = await SecureStore.getItemAsync(KEY_THEME)
  if (raw === "dark" || raw === "light" || raw === "system") {
    useThemeMode.setState({ mode: raw })
  }
}

/** 会话消息字号（仅作用于任务详情页消息正文，与桌面端 chatFontSize 对齐） */
export type ChatFontSize = 12 | 14 | 16

const KEY_CHAT_FONT_SIZE = "nexa.chat.fontSize"

interface ChatFontSizeState {
  size: ChatFontSize
  setSize: (s: ChatFontSize) => void
}

/** 消息字号 store（持久化） */
export const useChatFontSize = create<ChatFontSizeState>((set) => ({
  size: 14,
  setSize: (size) => {
    set({ size })
    void SecureStore.setItemAsync(KEY_CHAT_FONT_SIZE, String(size))
  },
}))

/** 启动时恢复持久化的消息字号 */
export async function initChatFontSize(): Promise<void> {
  const raw = await SecureStore.getItemAsync(KEY_CHAT_FONT_SIZE)
  const n = Number(raw)
  if (n === 12 || n === 14 || n === 16) useChatFontSize.setState({ size: n })
}

export interface Theme {
  /** 解析后的实际配色（system 时跟随系统外观） */
  colors: ThemeColors
  isDark: boolean
  mode: ThemeMode
}

export const ThemeContext = createContext<Theme>({ colors: palettes.dark, isDark: true, mode: "system" })

/** 各页面统一从这里取主题配色 */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}

/** 仅消费主题模式的组件用这个（避免拿全量配色） */
export function useResolvedTheme(): Theme {
  const mode = useThemeMode((s) => s.mode)
  const sys = useColorScheme()
  const isDark = mode === "system" ? sys !== "light" : mode === "dark"
  return { colors: isDark ? palettes.dark : palettes.light, isDark, mode }
}
