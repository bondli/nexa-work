/**
 * 通知提示音 —— 用 WebAudio 合成音色，避免引入音频资源文件
 * 名称与设置页「通知提示音」的下拉选项一致；「静音」表示不播放
 */

/** 可选提示音（设置页下拉顺序） */
export const NOTICE_SOUND_OPTIONS = ["灵动", "清脆", "悠扬", "静音"] as const

export type NoticeSound = (typeof NOTICE_SOUND_OPTIONS)[number]

/** 音色定义：一串音符（频率 Hz / 相对起始偏移 ms / 时长 ms） */
const PRESETS: Record<string, { freq: number; at: number; dur: number }[]> = {
  // 灵动：E6 → A6，清亮上扬
  灵动: [
    { freq: 1318.5, at: 0, dur: 110 },
    { freq: 1760, at: 90, dur: 170 },
  ],
  // 清脆：C7 → E7，短促明亮
  清脆: [
    { freq: 2093, at: 0, dur: 80 },
    { freq: 2637, at: 70, dur: 110 },
  ],
  // 悠扬：A5 → D6 → E6，柔和绵长
  悠扬: [
    { freq: 880, at: 0, dur: 180 },
    { freq: 1174.7, at: 160, dur: 180 },
    { freq: 1318.5, at: 320, dur: 280 },
  ],
}

let audioCtx: AudioContext | null = null

/** 惰性创建 AudioContext（Electron 默认允许无手势播放音频） */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioCtx) audioCtx = new Ctor()
  return audioCtx
}

/** 播放提示音；名称为「静音」或未知时不播放 */
export function playNoticeSound(name?: string): void {
  const preset = name ? PRESETS[name] : undefined
  if (!preset) return
  const ctx = getAudioContext()
  if (!ctx) return
  void ctx.resume?.()
  const start = ctx.currentTime
  for (const note of preset) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = note.freq
    const t0 = start + note.at / 1000
    const t1 = t0 + note.dur / 1000
    // 快起缓落的包络，避免爆音
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t1)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t1 + 0.02)
  }
}
