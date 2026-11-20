/**
 * 消息渲染偏好（纯渲染端，localStorage 持久化，不涉及主进程设置 schema）。
 * 驱动：思考过程是否显示、已完成过程是否默认收拢、思考片段是否默认收拢。
 * 与 theme-store 风格一致：zustand create + 手写 localStorage 读写。
 */
import { create } from "zustand"

const STORAGE_KEY = "nexa.transcript.prefs"

export interface TranscriptPrefs {
  /** 是否显示思考过程 */
  showThinking: boolean
  /** 已完成的 turn 过程是否默认收拢 */
  autoCollapseSettled: boolean
  /** 思考片段是否默认收拢 */
  autoCollapseThinking: boolean
}

interface TranscriptPrefsStore extends TranscriptPrefs {
  set: <K extends keyof TranscriptPrefs>(key: K, value: TranscriptPrefs[K]) => void
  toggle: (key: keyof TranscriptPrefs) => void
  reset: () => void
}

const DEFAULTS: TranscriptPrefs = {
  showThinking: true,
  autoCollapseSettled: true,
  autoCollapseThinking: true,
}

function load(): TranscriptPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<TranscriptPrefs>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function persist(prefs: TranscriptPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* localStorage 不可用时忽略（隐私模式等） */
  }
}

export const useTranscriptPrefs = create<TranscriptPrefsStore>((set, get) => ({
  ...load(),
  set: (key, value) => {
    const next = { ...get(), [key]: value }
    set(next)
    persist(next)
  },
  toggle: (key) => {
    const next = { ...get(), [key]: !get()[key] }
    set(next)
    persist(next)
  },
  reset: () => {
    set({ ...DEFAULTS })
    persist(DEFAULTS)
  },
}))
