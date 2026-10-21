/**
 * 通知提示音 —— 运行时合成正弦音（与桌面端 notification-sound.ts 同一组音色）
 *
 * 不引入音频资源文件：按音符频率在内存里生成 16bit PCM WAV，
 * 写入 cache 目录后交给 expo-audio 播放；「静音」直接跳过。
 */
import { createAudioPlayer, type AudioPlayer } from "expo-audio"
import * as FileSystem from "expo-file-system/legacy"

/** 可选提示音（与桌面端设置页下拉一致） */
export const NOTICE_SOUND_OPTIONS = ["灵动", "清脆", "悠扬", "静音"] as const
export type NoticeSound = (typeof NOTICE_SOUND_OPTIONS)[number]

/** 音色定义：频率 Hz / 相对起始偏移 ms / 时长 ms（对齐桌面端） */
const PRESETS: Record<string, { freq: number; at: number; dur: number }[]> = {
  灵动: [
    { freq: 1318.5, at: 0, dur: 110 },
    { freq: 1760, at: 90, dur: 170 },
  ],
  清脆: [
    { freq: 2093, at: 0, dur: 80 },
    { freq: 2637, at: 70, dur: 110 },
  ],
  悠扬: [
    { freq: 880, at: 0, dur: 180 },
    { freq: 1174.7, at: 160, dur: 180 },
    { freq: 1318.5, at: 320, dur: 280 },
  ],
}

const SAMPLE_RATE = 22050

/** 生成 WAV 字节（16bit 单声道 PCM） */
function buildWav(notes: { freq: number; at: number; dur: number }[]): Uint8Array {
  const totalMs = Math.max(...notes.map((n) => n.at + n.dur)) + 60
  const totalSamples = Math.ceil((totalMs / 1000) * SAMPLE_RATE)
  const data = new Int16Array(totalSamples)
  for (const note of notes) {
    const start = Math.floor((note.at / 1000) * SAMPLE_RATE)
    const len = Math.floor((note.dur / 1000) * SAMPLE_RATE)
    for (let i = 0; i < len && start + i < totalSamples; i++) {
      const t = i / SAMPLE_RATE
      // 快起缓落包络，避免爆音（与桌面端 gain 曲线近似）
      const env = Math.min(1, i / (SAMPLE_RATE * 0.02)) * Math.exp((-3.2 * i) / len)
      const v = Math.sin(2 * Math.PI * note.freq * t) * 0.18 * env
      data[start + i] += Math.round(v * 32767)
    }
  }
  // WAV 头（44 字节）+ PCM
  const buf = new Uint8Array(44 + data.length * 2)
  const view = new DataView(buf.buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i)
  }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + data.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, data.length * 2, true)
  buf.set(new Uint8Array(data.buffer), 44)
  return buf
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Uint8Array → base64（避免依赖全局 btoa） */
function toBase64(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : "="
    out += i + 2 < bytes.length ? B64[b2 & 63] : "="
  }
  return out
}

const fileCache = new Map<string, string>()
let player: AudioPlayer | null = null

/** 确保音色 wav 已写入 cache，返回 file:// uri */
async function ensureWavFile(name: string): Promise<string | null> {
  const cached = fileCache.get(name)
  if (cached) return cached
  const notes = PRESETS[name]
  if (!notes) return null
  const dir = FileSystem.cacheDirectory
  if (!dir) return null
  const uri = `${dir}nexa-notice-${name}.wav`
  try {
    await FileSystem.writeAsStringAsync(uri, toBase64(buildWav(notes)), {
      encoding: FileSystem.EncodingType.Base64,
    })
    fileCache.set(name, uri)
    return uri
  } catch {
    return null
  }
}

/** 播放提示音；「静音」/未知音色不播放 */
export async function playNoticeSound(name?: string): Promise<void> {
  if (!name || name === "静音") return
  const uri = await ensureWavFile(name)
  if (!uri) return
  try {
    player?.remove()
    player = createAudioPlayer({ uri })
    player.play()
  } catch {
    /* 播放失败静默忽略，不影响通知展示 */
  }
}
