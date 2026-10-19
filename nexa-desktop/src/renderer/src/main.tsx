import { createRoot } from "react-dom/client"
import { useEffect } from "react"
import App from "./App"
import "./global.css"
import { useConversationStore } from "@renderer/stores/conversation-store"
import { useExpertsStore } from "@renderer/stores/experts-store"
import { playNoticeSound } from "@renderer/lib/notification-sound"
import type { AgentEvent, NoticeEvent } from "@shared/ipc-channels"

/**
 * 顶层组件：挂载时订阅 Agent Event（主进程推送）
 * 事件桥接点 —— 所有 agent:event 都进 conversation-store.handleAgentEvent
 */
function Root() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.nexa) return
    const unsubscribe = window.nexa.onEvent((evt: AgentEvent) => {
      useConversationStore.getState().handleAgentEvent(evt)
    })
    // 桌面通知弹出时播放提示音（音色由设置页决定）
    const unsubscribeNotify = window.nexa.onNotify((payload: NoticeEvent) => {
      playNoticeSound(payload.sound)
    })
    // 初始化默认模型（从 settings.json 读取）
    void useConversationStore.getState().initDefaultModel()
    // 初始化专家列表
    void useExpertsStore.getState().fetchExperts()
    return () => {
      unsubscribe()
      unsubscribeNotify()
    }
  }, [])

  return <App />
}

const root = createRoot(document.getElementById("root")!)
root.render(<Root />)
