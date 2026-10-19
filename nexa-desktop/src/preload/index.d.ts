import type NexaAPI from "./index"

/**
 * 渲染进程访问的 window.nexa 全局类型声明
 */
declare global {
  interface Window {
    nexa: NexaAPI
  }
}

export {}
