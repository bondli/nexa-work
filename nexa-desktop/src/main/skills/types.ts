/**
 * Skill 类型定义 —— 对齐 docs/tech-design.md §2.2
 *
 * 每个 Skill 是 ~/.nexa/skills/<id>/ 下的一个目录:
 *   skill.yaml  描述文件（name/description/entry/inputs/outputs/prompt_hint）
 *   entry       可执行入口（Node 子进程运行）
 *
 * entry 协议: stdin 收 JSON {inputs}，stdout 出 JSON {ok, message, files?}；
 * 子进程 cwd 为会话 workspace，相对路径产物直接落在产物面板可见位置
 */
import type { SkillInfo, SkillInputSpec } from "@shared/ipc-channels"

export type { SkillInfo, SkillInputSpec }

/** 完整 Skill 对象（主进程内部使用） */
export interface Skill extends SkillInfo {
  /** entry 文件绝对路径 */
  entryPath: string
}

/** Skill 子进程执行结果 */
export interface SkillRunResult {
  ok: boolean
  message: string
  /** 产出的文件（相对 workspace） */
  files?: string[]
  error?: string
}
