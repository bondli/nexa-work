/**
 * skill_run 工具 —— Agent 调用 Skill 的统一入口
 * 可用 Skill 列表由 runtime 注入 system prompt（含 prompt_hint），Agent 按需调用
 */
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { SkillRegistry } from "../skills/registry"
import { runSkill } from "../skills/registry"

const skillRunParams = Type.Object({
  skill: Type.String({ description: "要调用的 Skill 名称（见系统提示中的可用 Skills 列表）" }),
  inputs: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Skill 输入参数（见 Skill 的 inputs 定义，必填参数缺失会报错）",
    })
  ),
})

export function createSkillRunTool(skills: SkillRegistry, workspacePath: string): AgentTool<typeof skillRunParams> {
  return {
    name: "skill_run",
    label: "调用 Skill",
    description: "执行指定的 Skill（如 CSV 分析等能力模块），产物写入工作目录。调用前请确认 inputs 满足 Skill 定义。",
    parameters: skillRunParams,
    execute: async (_id, params) => {
      // 失败必须 throw：pi-agent-core 只把抛出的异常判为 isError（返回值里的 isError 字段会被忽略）
      const skill = skills.getRunnable(params.skill)
      if (!skill) {
        throw new Error(`Skill "${params.skill}" 不存在或已被禁用`)
      }
      // 必填参数校验
      const missing = (skill.inputs ?? [])
        .filter((i) => i.required && (params.inputs?.[i.name] === undefined || params.inputs?.[i.name] === ""))
        .map((i) => i.name)
      if (missing.length > 0) {
        throw new Error(`缺少必填参数: ${missing.join(", ")}`)
      }
      const result = await runSkill(skill, params.inputs ?? {}, workspacePath)
      if (!result.ok) {
        throw new Error(result.error || result.message || "Skill 执行失败")
      }
      return {
        content: [{ type: "text", text: `${result.message}${result.files?.length ? `\n产出文件: ${result.files.join(", ")}` : ""}` }],
        details: result,
      }
    },
  }
}
