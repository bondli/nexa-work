/**
 * 配对设置页脚本：填写中继地址 + 配对码，与桌面端建立连接
 */
import type { RelayStatus } from "./relay-client.js"

const $ = (id: string): HTMLElement | null => document.getElementById(id)

const dot = $("dot") as HTMLSpanElement | null
const statusText = $("statusText") as HTMLSpanElement | null
const relayUrlInput = $("relayUrl") as HTMLInputElement | null
const codeInput = $("code") as HTMLInputElement | null
const pairBtn = $("pairBtn") as HTMLButtonElement | null
const msgEl = $("msg") as HTMLDivElement | null

function renderStatus(s: RelayStatus | undefined): void {
  if (!dot || !statusText) return
  const online = s?.peerOnline
  dot.className = "dot " + (online ? "on" : "")
  statusText.textContent = online
    ? `已连接：${s?.peer?.name ?? "电脑"}`
    : s?.connected
      ? "已连中继，等待桌面"
      : "未连接"
}

async function init(): Promise<void> {
  const s = (await chrome.runtime.sendMessage({ type: "getStatus" })) as RelayStatus
  renderStatus(s)
  // 回填已保存的中继地址
  const stored = await chrome.storage.local.get("nexa.relay.url")
  if (stored["nexa.relay.url"] && relayUrlInput) {
    relayUrlInput.value = stored["nexa.relay.url"] as string
  }
}
void init()

chrome.runtime.onMessage.addListener((m: { type: string; status?: RelayStatus }) => {
  if (m.type === "relay:status") renderStatus(m.status)
})

codeInput?.addEventListener("input", () => {
  if (codeInput) codeInput.value = codeInput.value.toUpperCase().slice(0, 6)
})

pairBtn?.addEventListener("click", async () => {
  if (!relayUrlInput || !codeInput || !pairBtn || !msgEl) return
  const url = relayUrlInput.value.trim()
  const code = codeInput.value.trim().toUpperCase()
  if (!url) {
    msgEl.textContent = "请填写中继地址"
    msgEl.className = "msg err"
    return
  }
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    msgEl.textContent = "请输入 6 位配对码"
    msgEl.className = "msg err"
    return
  }
  // 安全检查：非本地 HTTP 需确认
  try {
    const parsed = new URL(url)
    const isLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname)
    if (parsed.protocol === "http:" && !isLocal) {
      const ok = confirm(
        "⚠️ 安全警告\n\n您正在使用未加密的 HTTP 连接。\n在公共网络中，配对码和通信内容可能被截获。\n\n建议使用 HTTPS。\n\n确定要继续吗？",
      )
      if (!ok) return
    }
  } catch {
    /* invalid url, let relay handle error */
  }
  pairBtn.disabled = true
  msgEl.textContent = "配对中…"
  msgEl.className = "msg"
  const r = (await chrome.runtime.sendMessage({
    type: "pair",
    relayUrl: url,
    code,
  })) as { ok: boolean; error?: string }
  pairBtn.disabled = false
  if (r?.ok) {
    msgEl.textContent = "配对成功"
    msgEl.className = "msg ok"
  } else {
    msgEl.textContent = "配对失败：" + (r?.error || "未知")
    msgEl.className = "msg err"
  }
})
