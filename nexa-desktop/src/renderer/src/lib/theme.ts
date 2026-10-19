/**
 * 主题应用工具: 把 theme 偏好落到 documentElement.classList
 * CSS 变量双套已定义于 global.css（:root 亮色 / .dark 暗色）
 */
export type ThemePref = "system" | "light" | "dark"

/** 会话内容字号可选项 */
export type ChatFontSize = 12 | 14 | 16

let mediaSubscribed = false

/** 当前生效偏好（system 媒体查询变化时重新应用） */
let currentPref: ThemePref = "dark"

/** 把会话字号偏好落到 CSS 变量（仅影响消息内容字号） */
export function applyChatFontSize(px: ChatFontSize): void {
  document.documentElement.style.setProperty("--chat-font-size", `${px}px`)
}

export function applyTheme(pref: ThemePref): void {
  currentPref = pref
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)

  if (pref === "system" && !mediaSubscribed) {
    mediaSubscribed = true
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (currentPref === "system") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches
        document.documentElement.classList.toggle("dark", isDark)
      }
    })
  }
}
