/**
 * 弹窗脚本：展示已配对桌面设备与连接状态，入口跳转配对设置
 */
import type { RelayStatus } from "./relay-client.js"

const $ = (id: string): HTMLElement | null => document.getElementById(id)

const dot = $("dot") as HTMLSpanElement | null
const deviceName = $("deviceName") as HTMLSpanElement | null
const deviceState = $("deviceState") as HTMLSpanElement | null
const deviceMeta = $("deviceMeta") as HTMLDivElement | null
const optionsBtn = $("optionsBtn") as HTMLButtonElement | null
const logoMark = $("logoMark") as HTMLElement | null

/** 与桌面端 LogoIcon 同源的内联 SVG（红色图形，与插件图标一致） */
const LOGO_SVG = `<svg viewBox="0 0 1024 1024" width="22" height="22" xmlns="http://www.w3.org/2000/svg" fill="#DC2626">
  <path d="M757.333333 842.666667l13.269334 39.850666A42.666667 42.666667 0 0 1 730.154667 938.666667H293.845333a42.666667 42.666667 0 0 1-40.448-56.149334l13.269334-39.850666c10.24-30.72 30.464-56.149333 56.32-73.088A360.576 360.576 0 0 0 490.666667 810.666667h42.666666a361.088 361.088 0 0 0 167.68-41.002667c25.856 16.853333 46.08 42.24 56.32 73.002667z"/>
  <path d="M768 85.333333a128 128 0 0 1 128 128v153.002667c22.954667 8.106667 39.893333 28.928 42.368 53.973333L938.666667 426.666667v106.666666a64 64 0 0 1-57.856 63.701334L874.666667 597.333333l-10.752 0.042667A362.752 362.752 0 0 1 533.333333 810.666667h-42.666666a362.752 362.752 0 0 1-330.581334-213.290667L149.333333 597.333333A64 64 0 0 1 85.333333 533.333333V426.666667a64 64 0 0 1 52.48-62.976A362.794667 362.794667 0 0 1 490.666667 85.333333H768z m-234.154667 99.541334h-42.666666a266.666667 266.666667 0 0 0-9.813334 533.162666l9.813334 0.170667h42.666666a266.666667 266.666667 0 0 0 0-533.333333z"/>
  <path d="M533.845333 184.874667a266.666667 266.666667 0 0 1 0 533.333333h-42.666666a266.666667 266.666667 0 1 1 0-533.333333h42.666666zM394.666667 362.666667C365.226667 362.666667 341.333333 386.56 341.333333 416v85.333333a53.333333 53.333333 0 0 0 106.666667 0v-85.333333c0-29.44-23.893333-53.333333-53.333333-53.333333z m234.666666 0c-29.44 0-53.333333 23.893333-53.333333 53.333333v85.333333a53.333333 53.333333 0 0 0 106.666667 0v-85.333333c0-29.44-23.893333-53.333333-53.333334-53.333333z"/>
</svg>`

function renderStatus(s: RelayStatus | undefined): void {
  if (!dot || !deviceName || !deviceState || !deviceMeta) return
  const online = s?.peerOnline
  const connected = s?.connected
  if (online) {
    dot.className = "dot on"
    deviceName.textContent = s?.peer?.name || "Nexa 桌面端"
    deviceState.textContent = "在线"
    if (s?.peer?.deviceId) {
      deviceMeta.style.display = "block"
      deviceMeta.textContent = `设备 ID：${s.peer.deviceId}`
    }
  } else if (connected) {
    dot.className = "dot mid"
    deviceName.textContent = s?.peer?.name || "Nexa 桌面端"
    deviceState.textContent = "桌面端离线"
    deviceMeta.style.display = "none"
  } else {
    dot.className = "dot off"
    deviceName.textContent = "未配对设备"
    deviceState.textContent = "离线"
    deviceMeta.style.display = "none"
  }
}

async function refresh(): Promise<void> {
  const s = (await chrome.runtime.sendMessage({ type: "getStatus" })) as RelayStatus
  renderStatus(s)
}
void refresh()

chrome.runtime.onMessage.addListener((msg: { type: string; status?: RelayStatus }) => {
  if (msg.type === "relay:status") renderStatus(msg.status)
})

optionsBtn?.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "openOptions" })
})

// 初始化 logo
if (logoMark) logoMark.innerHTML = LOGO_SVG
