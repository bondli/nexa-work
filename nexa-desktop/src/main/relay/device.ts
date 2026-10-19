/**
 * 本机设备身份（M5b）
 * 首次使用时生成 ~/.nexa/device.json：{ deviceId, name }
 * deviceId 稳定不变，作为桌面端在中继侧的唯一标识
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir, hostname } from "node:os"
import { randomUUID } from "node:crypto"

interface DeviceIdentity {
  deviceId: string
  name: string
}

let cached: DeviceIdentity | null = null

export function getDeviceIdentity(): DeviceIdentity {
  if (cached) return cached
  const dir = join(homedir(), ".nexa")
  const file = join(dir, "device.json")
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<DeviceIdentity>
      if (raw.deviceId && raw.name) {
        cached = { deviceId: raw.deviceId, name: raw.name }
        return cached
      }
    }
  } catch {
    /* 损坏则重新生成 */
  }
  const identity: DeviceIdentity = {
    deviceId: `desktop-${randomUUID()}`,
    name: `${hostname() || "Mac"} 的 Mac`,
  }
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(identity, null, 2))
  } catch {
    /* 写失败也允许内存态运行 */
  }
  cached = identity
  return identity
}
