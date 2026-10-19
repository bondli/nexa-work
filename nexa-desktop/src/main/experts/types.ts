/**
 * 专家（Expert）类型定义 —— 对齐 docs/tech-design.md §2.1
 *
 * 专家 = 角色提示词包 + Agent Loop 调度策略 + 工具集限定
 * v1 约束: 单专家模式（不做专家团），路由为用户手动预选 + 会话内手动切换
 */
import type { ExpertDispatchStrategy, ExpertInfo } from "@shared/ipc-channels"

export type { ExpertDispatchStrategy, ExpertInfo }

/** 完整专家对象（主进程内部使用，含 system_prompt） */
export interface Expert extends ExpertInfo {
  systemPrompt: string
  /** 用户专家的 yaml 文件绝对路径 */
  filePath?: string
}
