/** React 版 popup：设备状态 + 笔记入口 + 配对设置 */
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { BookOpen, Settings } from "lucide-react"
import type { RelayStatus } from "../relay-client.js"
import "../styles/tailwind.css"

const LOGO_SVG = (
  <svg viewBox="0 0 1024 1024" width="22" height="22" xmlns="http://www.w3.org/2000/svg" fill="#DC2626">
    <path d="M757.333333 842.666667l13.269334 39.850666A42.666667 42.666667 0 0 1 730.154667 938.666667H293.845333a42.666667 42.666667 0 0 1-40.448-56.149334l13.269334-39.850666c10.24-30.72 30.464-56.149333 56.32-73.088A360.576 360.576 0 0 0 490.666667 810.666667h42.666666a361.088 361.088 0 0 0 167.68-41.002667c25.856 16.853333 46.08 42.24 56.32 73.002667z"/>
    <path d="M768 85.333333a128 128 0 0 1 128 128v153.002667c22.954667 8.106667 39.893333 28.928 42.368 53.973333L938.666667 426.666667v106.666666a64 64 0 0 1-57.856 63.701334L874.666667 597.333333l-10.752 0.042667A362.752 362.752 0 0 1 533.333333 810.666667h-42.666666a362.752 362.752 0 0 1-330.581334-213.290667L149.333333 597.333333A64 64 0 0 1 85.333333 533.333333V426.666667a64 64 0 0 1 52.48-62.976A362.794667 362.794667 0 0 1 490.666667 85.333333H768z m-234.154667 99.541334h-42.666666a266.666667 266.666667 0 0 0-9.813334 533.162666l9.813334 0.170667h42.666666a266.666667 266.666667 0 0 0 0-533.333333z"/>
    <path d="M533.845333 184.874667a266.666667 266.666667 0 0 1 0 533.333333h-42.666666a266.666667 266.666667 0 1 1 0-533.333333h42.666666zM394.666667 362.666667C365.226667 362.666667 341.333333 386.56 341.333333 416v85.333333a53.333333 53.333333 0 0 0 106.666667 0v-85.333333c0-29.44-23.893333-53.333333-53.333333-53.333333z m234.666666 0c-29.44 0-53.333333 23.893333-53.333333 53.333333v85.333333a53.333333 53.333333 0 0 0 106.666667 0v-85.333333c0-29.44-23.893333-53.333333-53.333334-53.333333z"/>
  </svg>
)

function Popup() {
  const [status, setStatus] = useState<RelayStatus | null>(null)

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "getStatus" }).then((s) => setStatus(s as RelayStatus))
    const listener = (msg: { type: string; status?: RelayStatus }) => {
      if (msg.type === "relay:status" && msg.status) setStatus(msg.status)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const online = status?.peerOnline
  const connected = status?.connected

  const dotClass = online
    ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]"
    : connected
    ? "bg-yellow-500"
    : "bg-neutral-600"

  const deviceLabel = online || connected ? (status?.peer?.name || "Nexa 桌面端") : "未配对设备"
  const stateLabel = online ? "在线" : connected ? "桌面端离线" : "离线"

  return (
    <div className="w-[300px] bg-neutral-950 text-neutral-50 p-4">
      {/* 头部：logo + 笔记入口 + 配对设置入口 */}
      <div className="flex items-center gap-2 pb-3 border-b border-neutral-800">
        <span className="w-[30px] h-[30px] rounded-full inline-flex items-center justify-center shrink-0">
          {LOGO_SVG}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold">Nexa</div>
          <div className="text-[11px] text-neutral-500 mt-px">浏览器插件</div>
        </div>
        <button
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("notes.html") })}
          className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-300 hover:text-neutral-50 transition-colors"
          title="打开笔记管理"
        >
          <BookOpen size={16} />
        </button>
        <button
          onClick={() => void chrome.runtime.sendMessage({ type: "openOptions" })}
          className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-300 hover:text-neutral-50 transition-colors"
          title="配对设置"
        >
          <Settings size={16} />
        </button>
      </div>

      {/* 设备状态卡片 */}
      <div className="my-3 bg-neutral-900 border border-neutral-800 rounded-xl p-3">
        <div className="flex items-center gap-2">
          <span className={`w-[9px] h-[9px] rounded-full shrink-0 ${dotClass}`} />
          <span className="text-[13px] font-semibold truncate">{deviceLabel}</span>
          <span className="text-[11px] text-neutral-400 ml-auto shrink-0">{stateLabel}</span>
        </div>
        {online && status?.peer?.deviceId && (
          <div className="text-[11px] text-neutral-500 mt-1.5 pl-[18px] break-all">
            设备 ID：{status.peer.deviceId}
          </div>
        )}
      </div>

      <div className="text-[11px] text-neutral-600 text-center leading-relaxed">
        采集文章 / 收藏图片请在网页上
        <br />
        使用右键菜单发起
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(<Popup />)
