/**
 * 安全存储封装：保存中继重连 token、relayUrl、设备 ID
 * 使用 expo-secure-store（原生加密，Expo Go 可用）
 */
import * as SecureStore from "expo-secure-store"

const KEY_TOKEN = "nexa.relay.token"
const KEY_RELAY_URL = "nexa.relay.url"
const KEY_DEVICE_ID = "nexa.device.id"
const KEY_NOTIFY = "nexa.notify.enabled"
const KEY_NOTICE_SOUND = "nexa.notify.sound"
const KEY_PAIRINGS = "nexa.pairings"
const KEY_CURRENT_DESKTOP = "nexa.current.desktop"

/** 一条配对记录：手机 ↔ 某台电脑 */
export interface RelayPairing {
  desktopId: string
  name: string
  token: string
  relayUrl: string
}

export const storage = {
  getToken: () => SecureStore.getItemAsync(KEY_TOKEN),
  setToken: (v: string) => SecureStore.setItemAsync(KEY_TOKEN, v),
  clearToken: () => SecureStore.deleteItemAsync(KEY_TOKEN),

  getRelayUrl: () => SecureStore.getItemAsync(KEY_RELAY_URL),
  setRelayUrl: (v: string) => SecureStore.setItemAsync(KEY_RELAY_URL, v),

  getDeviceId: () => SecureStore.getItemAsync(KEY_DEVICE_ID),
  setDeviceId: (v: string) => SecureStore.setItemAsync(KEY_DEVICE_ID, v),

  // 通知开关（定时任务完成/失败提醒），默认开
  getNotifyEnabled: async () => (await SecureStore.getItemAsync(KEY_NOTIFY)) !== "0",
  setNotifyEnabled: (v: boolean) => SecureStore.setItemAsync(KEY_NOTIFY, v ? "1" : "0"),

  // 通知提示音（与桌面端同名音色：灵动/清脆/悠扬/静音），默认「灵动」
  getNoticeSound: async () => (await SecureStore.getItemAsync(KEY_NOTICE_SOUND)) ?? "灵动",
  setNoticeSound: (v: string) => SecureStore.setItemAsync(KEY_NOTICE_SOUND, v),

  // ===== 多电脑配对：一部手机可配对多台桌面端，按 desktopId 存取 =====
  getPairings: async (): Promise<RelayPairing[]> => {
    const raw = await SecureStore.getItemAsync(KEY_PAIRINGS)
    if (!raw) return []
    try {
      const arr = JSON.parse(raw) as RelayPairing[]
      return Array.isArray(arr) ? arr : []
    } catch {
      return []
    }
  },
  setPairings: (list: RelayPairing[]) => SecureStore.setItemAsync(KEY_PAIRINGS, JSON.stringify(list)),
  getCurrentDesktopId: () => SecureStore.getItemAsync(KEY_CURRENT_DESKTOP),
  setCurrentDesktopId: (v: string) => SecureStore.setItemAsync(KEY_CURRENT_DESKTOP, v),
}

/** 生成或读取本机设备 ID（phone-<uuid>），持久化 */
export async function getDeviceIdentity(): Promise<{ deviceId: string; name: string }> {
  let deviceId = await storage.getDeviceId()
  if (!deviceId) {
    const uuid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    deviceId = `phone-${uuid}`
    await storage.setDeviceId(deviceId)
  }
  // 手机名在首次配对时由用户在配对页填写，这里给默认
  return { deviceId, name: "我的手机" }
}
