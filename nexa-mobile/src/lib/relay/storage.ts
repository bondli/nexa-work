/**
 * 安全存储封装：保存中继重连 token、relayUrl、设备 ID
 * 使用 expo-secure-store（原生加密，Expo Go 可用）
 */
import * as SecureStore from "expo-secure-store"

const KEY_TOKEN = "nexa.relay.token"
const KEY_RELAY_URL = "nexa.relay.url"
const KEY_DEVICE_ID = "nexa.device.id"

export const storage = {
  getToken: () => SecureStore.getItemAsync(KEY_TOKEN),
  setToken: (v: string) => SecureStore.setItemAsync(KEY_TOKEN, v),
  clearToken: () => SecureStore.deleteItemAsync(KEY_TOKEN),

  getRelayUrl: () => SecureStore.getItemAsync(KEY_RELAY_URL),
  setRelayUrl: (v: string) => SecureStore.setItemAsync(KEY_RELAY_URL, v),

  getDeviceId: () => SecureStore.getItemAsync(KEY_DEVICE_ID),
  setDeviceId: (v: string) => SecureStore.setItemAsync(KEY_DEVICE_ID, v),
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
