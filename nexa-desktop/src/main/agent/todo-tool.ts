/**
 * 任务规划（todo）工具：让模型为多步骤任务维护一份任务清单。
 *
 * 事件约定：
 * - 本轮第一次调用 → 推送 `plan.created`（渲染端新增一条 plan 消息）
 * - 后续调用 → 推送 `plan.updated`（整体替换最新 plan 消息的步骤，支持增删/改状态）
 * 每次调用都必须传完整清单，顺序保持稳定，仅状态随进度变化。
 */
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { AgentEvent, PlanStep } from "@shared/ipc-channels"

const todoParams = Type.Object({
  todos: Type.Array(
    Type.Object({
      description: Type.String({ description: "该步骤的简短描述（一句话）" }),
      status: Type.Union(
        [Type.Literal("pending"), Type.Literal("active"), Type.Literal("done"), Type.Literal("failed")],
        { description: "步骤状态：pending 未开始 / active 进行中 / done 已完成 / failed 失败" }
      ),
    }),
    { description: "完整的任务清单（每次调用都传全部步骤），顺序保持稳定" }
  ),
})

export function createTodoTool(sessionId: string, push: (event: AgentEvent) => void): AgentTool<typeof todoParams> {
  // 每次运行独立闭包：记录本轮是否已创建过清单
  let created = false

  return {
    name: "todo",
    label: "任务规划",
    description:
      "为多步骤任务维护一份任务清单（3–6 步）。首次调用会展示清单，之后每次调用传入完整清单以更新各步骤状态。" +
      "适用于需要多步骤执行、跨多个文件或耗时较长的任务；简单问答或单步操作不要使用。",
    parameters: todoParams,
    execute: async (_id, params) => {
      if (params.todos.length === 0) throw new Error("任务清单不能为空")
      const steps: PlanStep[] = params.todos.map((t, i) => ({
        id: `step-${i + 1}`,
        description: t.description,
        status: t.status,
      }))
      if (!created) {
        push({ type: "plan.created", sessionId, steps })
        created = true
      } else {
        push({ type: "plan.updated", sessionId, steps })
      }
      const done = steps.filter((s) => s.status === "done").length
      return {
        content: [{ type: "text", text: `任务清单已更新：${done}/${steps.length} 已完成` }],
        details: { steps: steps.length, done },
      }
    },
  }
}
