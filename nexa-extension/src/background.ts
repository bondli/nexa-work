/**
 * Service Worker：中继连接、右键菜单（采集文章 / 收藏图片）、消息分发
 *
 * 反馈策略：优先在页面右上角注入 toast（loading → 成功/失败），
 * 页面注入不可用（chrome:// 等受限页）时降级为系统通知。
 */
import { relay, type RelayStatus } from "./relay-client.js"

/** 待收藏图片的 storage key（favorite 表单页读取） */
const PENDING_FAVORITE_KEY = "nexa.pendingFavorite"

/** 文章 / 图片入库需等桌面端 LLM 生成元数据，超时放宽到 2 分钟 */
const INGEST_TIMEOUT_MS = 120_000

// ===== 系统通知（降级通道） =====
function notify(message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Nexa",
    message,
  })
}

// ===== 页内右上角 toast =====
type ToastPhase = "loading" | "success" | "error" | "info"

/**
 * 在指定标签页右上角显示/更新 toast。
 * 通过 DOM id 跨多次 executeScript 复用同一元素：loading 先出现，结束后原地变为结果。
 * 返回是否注入成功（受限页面会抛错，调用方降级为系统通知）。
 */
async function pageToast(tabId: number, phase: ToastPhase, text: string): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [phase, text],
      func: (p: string, msg: string) => {
        const ID = "nexa-ingest-toast"
        let host = document.getElementById(ID)
        if (!host) {
          host = document.createElement("div")
          host.id = ID
          host.style.cssText = [
            "position:fixed",
            "top:16px",
            "right:16px",
            "z-index:2147483647",
            "display:flex",
            "align-items:center",
            "gap:9px",
            "padding:11px 16px",
            "border-radius:12px",
            "font-size:13px",
            "line-height:1.4",
            "font-family:-apple-system,'Segoe UI',sans-serif",
            "color:#fafafa",
            "background:#1f1f1f",
            "box-shadow:0 6px 20px rgba(0,0,0,.28)",
            "max-width:340px",
          ].join(";")
          document.documentElement.appendChild(host)
        }
        // 内容区（spinner / 状态点 + 文本）
        const textSpan = document.createElement("span")
        textSpan.textContent = msg
        host.textContent = ""
        if (p === "loading") {
          const spinner = document.createElement("span")
          spinner.style.cssText =
            "width:14px;height:14px;flex-shrink:0;border:2px solid rgba(255,255,255,.3);border-top-color:#fafafa;border-radius:50%;"
          host.appendChild(spinner)
          // Web Animations API 驱动旋转，避免注入 <style> 受页面 CSP 影响
          spinner.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
            duration: 800,
            iterations: Infinity,
          })
          host.style.background = "#1f1f1f"
          host.style.color = "#fafafa"
        } else {
          const dot = document.createElement("span")
          const color = p === "success" ? "#4ade80" : p === "error" ? "#f87171" : "#fbbf24"
          dot.style.cssText = `width:9px;height:9px;flex-shrink:0;border-radius:50%;background:${color};`
          host.appendChild(dot)
          host.style.background = p === "success" ? "#14532d" : p === "error" ? "#7f1d1d" : "#422006"
        }
        host.appendChild(textSpan)
        // 结果态自动消失（loading 常驻直到被结果覆盖）
        if (p !== "loading") {
          const el = host
          setTimeout(() => {
            el.style.transition = "opacity .4s"
            el.style.opacity = "0"
            setTimeout(() => el.remove(), 450)
          }, p === "error" ? 7000 : 4200)
        }
      },
    })
    return true
  } catch {
    return false
  }
}

// ===== 右键菜单 =====
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "nexa-ingest-article",
      title: "Nexa采集到资料库",
      contexts: ["page", "selection"],
    })
    chrome.contextMenus.create({
      id: "nexa-favorite-image",
      title: "Nexa 收藏图片",
      contexts: ["image"],
    })
  })
})

chrome.runtime.onStartup.addListener(() => {
  void relay.resume()
})
void relay.resume()

// ===== 状态广播给 popup =====
function broadcastStatus(): void {
  chrome.runtime.sendMessage({ type: "relay:status", status: relay.status }).catch(() => {
    /* popup 未打开时忽略 */
  })
}
relay.onStatus(broadcastStatus)

// ===== 与页面（popup / favorite 表单）通信 =====
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg.type === "getStatus") {
    sendResponse(relay.status)
    return false
  }
  if (msg.type === "pair") {
    relay
      .pair(msg.relayUrl as string, msg.code as string)
      .then(() => sendResponse({ ok: true }))
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }))
    return true // async
  }
  if (msg.type === "favoriteSubmit") {
    void submitFavorite(String(msg.title ?? ""), String(msg.description ?? ""))
      .then((r) => sendResponse(r))
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }))
    return true
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage()
    sendResponse({ ok: true })
    return false
  }
  // 通用 RPC 转发（笔记页等使用）：把 method/payload 透传给桌面端 relay
  if (msg.type === "rpc") {
    const method = String(msg.method ?? "")
    if (!method) {
      sendResponse({ ok: false, error: "method 必填" })
      return false
    }
    void (async () => {
      try {
        await relay.ensureConnected()
        if (!relay.status.peerOnline) {
          sendResponse({ ok: false, error: "桌面端未连接，请确认桌面端 Nexa 已打开" })
          return
        }
        const data = await relay.call(method, msg.payload, 30_000)
        sendResponse({ ok: true, data })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return true
  }
  return false
})

// ===== 采集当前页面（右键菜单触发）：页内 toast 给出 loading → 结果 =====
async function ingestActivePage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const tabId = tab?.id
  // 受限页面（chrome:// 等）注入失败时降级系统通知
  const toast = (phase: ToastPhase, text: string): Promise<boolean> =>
    tabId ? pageToast(tabId, phase, text) : Promise.resolve(false)

  await toast("loading", "Nexa 正在采集此页面…")
  try {
    // MV3 SW 休眠唤醒后状态可能过期：先确保连接就绪（最多等 8s）
    await relay.ensureConnected()
    if (!relay.status.peerOnline) throw new Error("桌面端未连接，请确认桌面端 Nexa 已打开")
    if (!tabId) throw new Error("无活动标签页")

    // 本地提取正文纯文本（不发整页 HTML：大页面会超中继消息上限被掐断连接）
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const metaDesc =
          document.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""
        const root =
          document.querySelector("article") ?? document.querySelector("main") ?? document.body
        const text = (root?.innerText || document.body?.innerText || "").slice(0, 200_000)
        return { url: location.href, title: document.title, text, description: metaDesc }
      },
    })
    if (!result?.text || result.text.trim().length < 50) {
      throw new Error("页面正文提取失败或过短，请换用选中文本后再试")
    }
    const res = await relay.call<{ ok?: boolean; duplicate?: boolean; title?: string }>(
      "library:ingest-article",
      { url: result.url, title: result.title, text: result.text, description: result.description },
      INGEST_TIMEOUT_MS,
    )
    if (res?.duplicate) {
      const shown = await toast("info", "该文章已在资料库中，重复采集已跳过")
      if (!shown) notify("该文章已在资料库中，重复采集已跳过")
    } else {
      const shown = await toast("success", `采集成功：${res?.title || result?.title || "未命名"}`)
      if (!shown) notify(`文章已采集到资料库：${res?.title || result?.title || "未命名"}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const shown = await toast("error", "采集失败：" + msg)
    if (!shown) notify("文章采集失败：" + msg)
  }
}

// ===== 右键收藏图片：下载图片 → 页内浮层表单填写标题/描述 =====
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nexa-ingest-article") {
    void ingestActivePage()
    return
  }
  if (info.menuItemId === "nexa-favorite-image" && info.srcUrl) {
    void openFavoriteForm(info.srcUrl, tab)
  }
})

async function openFavoriteForm(srcUrl: string, tab?: chrome.tabs.Tab | undefined): Promise<void> {
  try {
    await relay.ensureConnected()
    if (!relay.status.peerOnline) throw new Error("桌面端未连接，请确认桌面端 Nexa 已打开")
    // Service Worker 中 fetch 依赖 host_permissions: <all_urls>，跨域图片可直接取
    const res = await fetch(srcUrl, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`图片下载失败（HTTP ${res.status}）`)
    const blob = await res.blob()
    if (blob.size > 10 * 1024 * 1024) throw new Error("图片超过 10MB，暂不支持收藏")
    const b64 = arrayBufferToBase64(await blob.arrayBuffer())
    await chrome.storage.local.set({
      [PENDING_FAVORITE_KEY]: {
        url: srcUrl,
        data: b64,
        mimeType: blob.type || "image/png",
        pageUrl: tab?.url ?? "",
        pageTitle: tab?.title ?? "",
      },
    })
    if (!tab?.id) throw new Error("无活动标签页")
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [PENDING_FAVORITE_KEY],
      func: injectFavoritePanel,
    })
  } catch (e) {
    notify("图片收藏失败：" + (e instanceof Error ? e.message : String(e)))
  }
}

/**
 * 页内浮层收藏表单（注入到页面右上角，替代独立弹窗）。
 * 自包含函数：经 executeScript 序列化后在页面 isolated world 执行，
 * 可用 chrome.storage / chrome.runtime 与后台通信，数据从 storage 读取。
 */
function injectFavoritePanel(key: string): void {
  document.getElementById("nexa-favorite-panel")?.remove()
  const host = document.createElement("div")
  host.id = "nexa-favorite-panel"
  host.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "z-index:2147483647",
    "width:340px",
    "background:#171717",
    "border:1px solid #262626",
    "border-radius:14px",
    "box-shadow:0 8px 28px rgba(0,0,0,.4)",
    "color:#fafafa",
    "font-family:-apple-system,'Segoe UI',sans-serif",
    "font-size:13px",
    "padding:14px",
  ].join(";")
  host.innerHTML = [
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#DC2626;flex-shrink:0;"></span>',
    '  <span style="font-weight:700;font-size:14px;">收藏图片到 Nexa</span>',
    '  <span id="nexa-fav-close" style="margin-left:auto;cursor:pointer;color:#737373;font-size:16px;line-height:1;">&times;</span>',
    "</div>",
    '<div style="display:flex;justify-content:center;margin-bottom:10px;">',
    '  <img id="nexa-fav-preview" style="max-width:100%;max-height:150px;border-radius:10px;border:1px solid #262626;background:#0a0a0a;object-fit:contain;" alt="预览"/>',
    "</div>",
    '<label style="display:block;font-size:11px;color:#a3a3a3;margin-bottom:4px;">标题</label>',
    '<input id="nexa-fav-title" style="width:100%;box-sizing:border-box;background:#0a0a0a;border:1px solid #262626;border-radius:8px;padding:8px 10px;color:#fafafa;font-size:13px;outline:none;margin-bottom:9px;" placeholder="给图片起个名字" maxlength="60"/>',
    '<label style="display:block;font-size:11px;color:#a3a3a3;margin-bottom:4px;">描述</label>',
    '<textarea id="nexa-fav-desc" style="width:100%;box-sizing:border-box;height:60px;resize:none;background:#0a0a0a;border:1px solid #262626;border-radius:8px;padding:8px 10px;color:#fafafa;font-size:13px;outline:none;margin-bottom:10px;font-family:inherit;line-height:1.4;" placeholder="图片内容、用途或备注…"></textarea>',
    '<button id="nexa-fav-submit" style="width:100%;background:#DC2626;color:#fff;border:0;border-radius:8px;padding:9px;font-size:13px;font-weight:600;cursor:pointer;">收藏到资料库</button>',
    '<div id="nexa-fav-msg" style="font-size:12px;margin-top:8px;min-height:16px;text-align:center;"></div>',
  ].join("")
  document.documentElement.appendChild(host)

  const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
  const msg = $("nexa-fav-msg")
  const titleInput = $("nexa-fav-title") as HTMLInputElement
  const descInput = $("nexa-fav-desc") as HTMLTextAreaElement
  const submitBtn = $("nexa-fav-submit") as HTMLButtonElement

  $("nexa-fav-close").addEventListener("click", () => {
    host.remove()
    void chrome.storage.local.remove(key)
  })

  void chrome.storage.local.get(key).then((st) => {
    const p = st[key] as { data: string; mimeType: string; pageTitle: string; url: string } | undefined
    if (!p) {
      msg.textContent = "没有待收藏的图片"
      msg.style.color = "#f87171"
      return
    }
    ;($("nexa-fav-preview") as HTMLImageElement).src = `data:${p.mimeType};base64,${p.data}`
    if (!titleInput.value) {
      const filename = p.url.split("/").pop()?.split("?")[0] ?? ""
      titleInput.value = (p.pageTitle || decodeURIComponent(filename) || "未命名图片").slice(0, 60)
    }
  })

  let busy = false
  submitBtn.addEventListener("click", async () => {
    if (busy) return
    busy = true
    submitBtn.disabled = true
    submitBtn.textContent = "收藏中…"
    msg.textContent = ""
    try {
      const r = (await chrome.runtime.sendMessage({
        type: "favoriteSubmit",
        title: titleInput.value.trim(),
        description: descInput.value.trim(),
      })) as { ok: boolean; error?: string }
      if (!r?.ok) throw new Error(r?.error ?? "未知错误")
      msg.textContent = "收藏成功"
      msg.style.color = "#4ade80"
      await chrome.storage.local.remove(key)
      setTimeout(() => host.remove(), 900)
    } catch (e) {
      msg.textContent = "收藏失败：" + (e instanceof Error ? e.message : String(e))
      msg.style.color = "#f87171"
      submitBtn.disabled = false
      submitBtn.textContent = "收藏到资料库"
    } finally {
      busy = false
    }
  })
}

/** favorite 表单页提交：真正入库 */
async function submitFavorite(title: string, description: string): Promise<{ ok: boolean; error?: string }> {
  const stored = await chrome.storage.local.get(PENDING_FAVORITE_KEY)
  const pending = stored[PENDING_FAVORITE_KEY] as
    | { url: string; data: string; mimeType: string; pageUrl: string; pageTitle: string }
    | undefined
  if (!pending) return { ok: false, error: "没有待收藏的图片" }
  await relay.call(
    "library:favorite-image",
    {
      url: pending.url,
      data: pending.data,
      mimeType: pending.mimeType,
      title: title || undefined,
      description: description || undefined,
      pageUrl: pending.pageUrl || undefined,
    },
    INGEST_TIMEOUT_MS,
  )
  await chrome.storage.local.remove(PENDING_FAVORITE_KEY)
  notify(`图片已收藏到资料库：${title || "未命名"}`)
  return { ok: true }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = ""
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

// 保持 RelayStatus 类型被消费（tsc noUnusedLocals 下 re-export 合法）
export type { RelayStatus }
