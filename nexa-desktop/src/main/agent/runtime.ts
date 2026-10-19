/**
 * Agent Runtime - 主进程内运行 pi-agent-core Agent Loop
 *
 * 职责:
 * - 管理会话运行时状态 (内存中的消息上下文 + AbortController)
 * - 将 pi AgentEvent 翻译为 Nexa AgentEvent 推送渲染进程
 * - 消息 / 工具调用持久化到 SQLite
 * - pause / resume / delete 的执行控制
 */
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join, basename } from "node:path"
import {
  runAgentLoop,
  runAgentLoopContinue,
  generateSummary,
  type AgentEvent as PiAgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core"
import type { ImageContent, Message as PiMessage, Model, TextContent, UserMessage } from "@earendil-works/pi-ai"
import type { AgentEvent, ChatAttachment, SessionMode, SessionStatus } from "@shared/ipc-channels"
import type { Database, Session } from "../db/types"
import type { Expert } from "../experts/types"
import type { ExpertRegistry } from "../experts/registry"
import type { SkillRegistry } from "../skills/registry"
import type { ConnectorManager } from "../connectors/registry"
import type { KnowledgeBaseService } from "../knowledge/service"
import { getApiKey, resolveModel } from "./settings"
import { normalizeTitle } from "./llm-helper"
import { createBuiltinTools } from "./tools"
import { createSkillRunTool } from "./skill-tool"
import { createConnectorCallTool } from "./connector-tool"
import { createKnowledgeTools } from "./kb-tools"
import { MemoryEngine } from "./memory-engine"
import { createMemoryTools } from "./memory-tools"
import {
  createScheduleCreateTool,
  createScheduleListTool,
  createScheduleToggleTool,
  createScheduleDeleteTool,
  createScheduleRunNowTool,
} from "./schedule-tools"

/** 会话运行时状态 */
interface RuntimeSession {
  id: string
  mode: SessionMode
  workspacePath: string
  model: Model<string>
  /** 当前专家（切换专家只影响下一轮 loop） */
  expert: Expert | null
  /** pi Message 上下文（跨轮次累积） */
  messages: AgentMessage[]
  status: SessionStatus
  abortController: AbortController | null
}

/** delta 推送节流间隔 (ms) */
const DELTA_FLUSH_INTERVAL = 30

/** 从用户消息 content 中提取纯文本（多模态消息只取 text 块） */
function messageText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("")
}

/**
 * 生成附件说明（注入 system prompt）。
 * - 模型支持视觉：图片已随消息作为 ImageContent 提供，这里补充落盘路径，便于用工具（如 kb_add_image）处理
 * - 模型不支持视觉：显式告知无法看到图片内容，避免模型凭空编造图片细节，并提示用户切换模型
 */
function buildAttachmentNote(attachments: ChatAttachment[], model: Model<string>): string {
  const list = attachments.map((a, i) => `${i + 1}. ${a.path}`).join("\n")
  const n = attachments.length
  if (model.input.includes("image")) {
    return `本轮用户附加了 ${n} 张图片（已随消息提供，可直接识别）。图片落盘路径（如需用工具处理可直接引用）:\n${list}`
  }
  return `本轮用户附加了 ${n} 张图片，但当前模型「${model.id}」不支持图片理解，你无法看到图片内容。
请如实告知用户当前模型无法识别图片，并建议在输入框上方切换到支持视觉的模型（如 GPT-4o / Claude 3.5 Sonnet）后再重试；
不要猜测或编造图片内容。图片落盘路径（如用户只是要求归档/收藏，可直接用工具处理该文件）:\n${list}`
}

/**
 * 会话标题生成提示词。
 * 首条消息常常是一段带 Markdown 结构的提示词（"## Goal / ## 要求"），模型很容易直接照抄开头，
 * 因此必须显式约束输出形态 + 给出少样本，并在返回后用 normalizeTitle 再清洗校验一次。
 */
const TITLE_SYSTEM_PROMPT = `你是会话标题生成器。用户会给你一段任务描述，其中可能包含 Markdown 结构（## 小标题、列表、代码块等）。
请只输出一个中文会话标题，规则：
1. 概括任务的核心意图，不要照抄原文片段
2. 不超过 12 个字
3. 不要出现 Markdown 符号、引号、标点、emoji
4. 不要"标题："之类前缀，不要解释，只输出标题文本本身
5. 忽略 Goal / 背景 / 需求 这类结构性小标题，抓住真正的任务内容

示例：
输入：## Goal
- 给 Nexa 桌面端加上会员订阅能力，包含支付与权限校验
输出：会员订阅能力开发
输入：帮我看看这段 Python 代码为什么报 KeyError
输出：Python 报错排查
输入：把这份财报整理成一份 10 页的 PPT
输出：财报整理成 PPT

待处理的任务描述如下，请只输出标题：`

export class AgentRuntime {
  private db: Database
  private pushEvent: (event: AgentEvent) => void
  private experts: ExpertRegistry
  private skills: SkillRegistry
  private connectors: ConnectorManager
  private kb: KnowledgeBaseService
  private memory: MemoryEngine
  private sessions = new Map<string, RuntimeSession>()
  /** 定时任务"立即执行"回调，由 main/index.ts 在 SchedulerService 创建后注入 */
  private schedulerRunNow: ((jobId: string) => Promise<void>) | null = null

  /** 注入调度器（避免构造期循环依赖） */
  setSchedulerRunner(fn: (jobId: string) => Promise<void>): void {
    this.schedulerRunNow = fn
  }

  constructor(db: Database, pushEvent: (event: AgentEvent) => void, experts: ExpertRegistry, skills: SkillRegistry, connectors: ConnectorManager, kb: KnowledgeBaseService, memory: MemoryEngine) {
    this.db = db
    this.pushEvent = pushEvent
    this.experts = experts
    this.skills = skills
    this.connectors = connectors
    this.kb = kb
    this.memory = memory
  }

  isRunning(sessionId: string): boolean {
    const s = this.sessions.get(sessionId)
    return s?.status === "running"
  }

  /**
   * 启动会话：写入首条用户消息 → 启动 Agent Loop
   * main/index.ts 的 SESSION_CREATE 已完成 DB session 创建和 workspace 创建
   */
  async startSession(session: Session, initialMessage: string, attachments: ChatAttachment[] = []): Promise<void> {
    const state: RuntimeSession = {
      id: session.id,
      mode: session.mode as SessionMode,
      workspacePath: session.workspace_path,
      model: resolveModel(session.model)!,
      expert: this.experts.get(session.current_expert) ?? this.experts.getDefault(),
      messages: [],
      status: "running",
      abortController: null,
    }
    this.sessions.set(session.id, state)
    await this.runTurn(state, [this.createUserMessage(initialMessage, attachments, state.model)], false, attachments)
  }

  /**
   * 从 DB 重建会话运行时状态（应用重启后续跑旧会话 / 定时任务触发）
   * tool role 历史丢弃（toolResult 必须有配对的 tool_call，无法只靠文本重建）
   */
  hydrateSession(sessionId: string): RuntimeSession | null {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const session = this.db.session.get(sessionId)
    if (!session) return null
    const model = resolveModel(session.model)
    if (!model) throw new Error(`无法解析模型: ${session.model}`)
    const rows = this.db.message.listBySession(sessionId)
    const messages: AgentMessage[] = []
    for (const row of rows) {
      if (row.role === "user") {
        messages.push({ role: "user", content: row.content, timestamp: row.created_at * 1000 })
      } else if (row.role === "assistant" && row.content.trim()) {
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: row.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: row.created_at * 1000,
        } as AgentMessage)
      }
    }
    const state: RuntimeSession = {
      id: session.id,
      mode: session.mode as SessionMode,
      workspacePath: session.workspace_path,
      model,
      expert: this.experts.get(session.current_expert) ?? this.experts.getDefault(),
      messages,
      status: session.status === "running" ? "paused" : session.status as SessionStatus,
      abortController: null,
    }
    this.sessions.set(session.id, state)
    return state
  }

  /**
   * 定时任务用：续跑会话并等待完成，返回最后一条助手回复文本。
   * 会话不在内存时自动从 DB hydrate。
   */
  async continueSessionAsync(sessionId: string, prompt: string): Promise<string> {
    const state = this.hydrateSession(sessionId)
    if (!state) throw new Error(`会话不存在: ${sessionId}`)
    if (state.status === "running") throw new Error("会话正在执行中，请稍后再试")
    state.status = "running"
    this.db.session.updateStatus(sessionId, "running")
    this.pushEvent({ type: "session.status", sessionId, status: "running" })
    await this.runTurn(state, [this.createUserMessage(prompt, null, state.model)], false)
    const finalStatus = state.status as SessionStatus
    if (finalStatus === "paused") throw new Error("任务已暂停（可能在等待用户决策）")
    if (finalStatus === "failed") throw new Error("会话执行失败")
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]
      if (m.role !== "assistant") continue
      const text = (m as { content?: unknown[] }).content
        ?.filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim()
      if (text) return text
    }
    return "(助手无文本回复)"
  }

  /**
   * 向已有会话发送新消息（续跑）。running 状态下拒绝。
   * 同步校验并立即返回 true/false，Agent Loop 异步执行；
   * 需推送 session.status 让渲染端即时进入 running 态（输入框禁用/暂停按钮）
   */
  sendMessage(sessionId: string, text: string, attachments: ChatAttachment[] = []): boolean {
    // 应用重启后旧会话不在内存，先 hydrate
    const state = this.hydrateSession(sessionId)
    if (!state || state.status === "running") return false
    state.status = "running"
    this.db.session.updateStatus(sessionId, "running")
    this.pushEvent({ type: "session.status", sessionId, status: "running" })
    void this.runTurn(state, [this.createUserMessage(text, attachments, state.model)], false, attachments).catch(() => {})
    return true
  }

  /** 暂停执行（abort 当前 loop） */
  pause(sessionId: string): boolean {
    const state = this.sessions.get(sessionId)
    if (!state || state.status !== "running") return false
    state.abortController?.abort()
    return true
  }

  /** 恢复执行（从上下文续跑，不注入新消息）。仅 paused 状态可恢复。同 sendMessage：同步返回，Loop 异步 */
  resume(sessionId: string): boolean {
    const state = this.sessions.get(sessionId)
    if (!state || state.status !== "paused") return false
    state.status = "running"
    this.db.session.updateStatus(sessionId, "running")
    this.pushEvent({ type: "session.status", sessionId, status: "running" })
    void this.runTurn(state, [], true).catch(() => {})
    return true
  }

  /** 删除会话前停止执行 */
  stop(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state) {
      state.abortController?.abort()
      this.sessions.delete(sessionId)
    }
  }

  /**
   * 切换会话专家：保留对话历史，只替换 system_prompt + 工具集（下一轮生效）
   * 运行中也允许切换（in-flight loop 不受影响）
   */
  setExpert(sessionId: string, expertId: string): boolean {
    const expert = this.experts.get(expertId)
    if (!expert) return false
    const from = this.db.session.get(sessionId)?.current_expert ?? "builtin:general"
    this.db.session.setCurrentExpert(sessionId, expert.id)
    const state = this.sessions.get(sessionId)
    if (state) state.expert = expert
    this.pushEvent({ type: "session.expert-switch", sessionId, from, to: expert.id })
    return true
  }

  /** 会话内切换模型（下一轮生效），对齐 setExpert 模式 */
  setModel(sessionId: string, modelStr: string): boolean {
    const model = resolveModel(modelStr)
    if (!model) return false
    this.db.session.setModel(sessionId, modelStr)
    const state = this.sessions.get(sessionId)
    if (state) state.model = model
    this.pushEvent({ type: "session.model-switch", sessionId, model: modelStr })
    return true
  }

  // ==========================================
  // 内部实现
  // ==========================================

  /**
   * 组装用户消息。
   * 带图片附件时：模型支持视觉则转成 ImageContent 多模态内容（图片 base64 随消息发送）；
   * 不支持视觉则只发文本（附件说明由 system prompt 注入，见 attachmentNote）。
   * 持久化与事件推送取 messageText()，因此展示的正文始终是用户原始输入，不含附件说明。
   */
  private createUserMessage(content: string, attachments: ChatAttachment[] | null | undefined, model: Model<string>): UserMessage {
    const images = attachments ?? []
    if (images.length === 0 || !model.input.includes("image")) {
      return { role: "user", content, timestamp: Date.now() }
    }
    const blocks: (TextContent | ImageContent)[] = [{ type: "text", text: content }]
    for (const a of images) {
      try {
        blocks.push({ type: "image", data: readFileSync(a.path).toString("base64"), mimeType: a.mimeType })
      } catch {
        /* 文件不可读则跳过该图（附件说明里仍会保留路径） */
      }
    }
    return { role: "user", content: blocks, timestamp: Date.now() }
  }

  private buildSystemPrompt(state: RuntimeSession, toolNames: string[], attachmentNote?: string | null): string {
    const modeDesc = state.mode === "free" ? "自由任务（独立工作目录）" : "项目编码（绑定用户项目目录）"
    const identity = state.expert
      ? `你是 Nexa（当前专家: ${state.expert.name}），运行在用户桌面上的智能工作助手。`
      : "你是 Nexa，一个运行在用户桌面上的智能工作助手。"
    const lines = [identity]
    if (state.expert) {
      lines.push("", state.expert.systemPrompt.trim())
    }
    // 记忆注入（按模式筛选：project 多 state，free 多 preference）
    const memoryBlock = this.memory.buildMemoryBlock(state.mode)
    if (memoryBlock) lines.push("", memoryBlock)
    lines.push(
      "",
      `当前会话模式: ${modeDesc}`,
      `当前工作目录: ${state.workspacePath}`,
      `可用工具: ${toolNames.join(", ") || "（无）"}`,
    )
    // project 模式: 扫描 AGENTS.md / README.md 注入上下文
    if (state.mode === "project" && state.workspacePath) {
      const projectContext = this.scanProjectContext(state.workspacePath)
      if (projectContext) lines.push("", projectContext)
    }
    // 可用 Skills 注入（含用法提示），供 Agent 按需调用 skill_run
    const skills = this.skills.listInfo().filter((s) => s.enabled)
    if (skills.length > 0) {
      lines.push("", "可用 Skills（用 skill_run 工具调用）:")
      for (const s of skills) {
        const inputs = (s.inputs ?? [])
          .map((i) => `${i.name}${i.required ? "(必填)" : "(选填)"}`)
          .join(", ")
        lines.push(`- ${s.id}: ${s.description}｜参数: ${inputs || "无"}`)
        if (s.promptHint?.trim()) lines.push(`  用法: ${s.promptHint.trim().replace(/\n+/g, " ")}`)
      }
    }
    // 可用连接器注入（凭据由 ConnectorManager 统一解密注入，Agent 不可见）
    const connectors = this.connectors.list()
    if (connectors.length > 0) {
      lines.push("", "可用连接器（用 connector_call 工具调用）:")
      for (const c of connectors) {
        const eps = c.endpoints.map((e) => `${e.name}(${e.method} ${e.path})`).join(", ") || "（无）"
        lines.push(`- ${c.id}（${c.displayName}）: 端点: ${eps}`)
      }
    }
    // 本轮用户附件的说明（图片已随消息发送 / 或当前模型不支持视觉）
    if (attachmentNote) lines.push("", attachmentNote)
    lines.push(
      "文件操作必须限定在工作目录内。",
      "回复使用 Markdown 格式。",
    )
    return lines.join("\n")
  }

  /** project 模式: 扫描 AGENTS.md / README.md 提取项目上下文 */
  private scanProjectContext(projectPath: string): string | null {
    const candidates = ["AGENTS.md", "CLAUDE.md", "README.md", "readme.md", "README.rst"]
    const chunks: string[] = []
    const projectName = basename(projectPath)
    for (const name of candidates) {
      const p = join(projectPath, name)
      if (!existsSync(p)) continue
      try {
        const content = readFileSync(p, "utf-8").trim()
        if (!content) continue
        // 截断过长的文档（最多 8000 字符）
        const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n...(已截断)" : content
        chunks.push(`### ${name}\n${truncated}`)
        break // 只读第一个找到的文件
      } catch { /* ignore */ }
    }
    if (chunks.length === 0) return null
    return `项目上下文（${projectName}）:\n${chunks.join("\n\n")}`
  }

  /** 组装工具集: 内置基础工具 + skill_run + connector_call，再按专家白名单/禁用列表过滤 */
  private resolveTools(state: RuntimeSession): AgentTool[] {
    const all = [
      ...createBuiltinTools(
        state.workspacePath,
        // dispatch_strategy.step_timeout_seconds 应用为 bash 默认超时
        state.expert?.dispatchStrategy?.stepTimeoutSeconds
          ? state.expert.dispatchStrategy.stepTimeoutSeconds * 1000
          : undefined
      ),
      createSkillRunTool(this.skills, state.workspacePath),
      createConnectorCallTool(this.connectors),
      ...createKnowledgeTools(this.kb, state.id),
      ...createMemoryTools(this.memory, this.db, state.id),
      createScheduleCreateTool(this.db, state.id),
      createScheduleListTool(this.db),
      createScheduleToggleTool(this.db),
      createScheduleDeleteTool(this.db),
      ...(this.schedulerRunNow ? [createScheduleRunNowTool(this.schedulerRunNow)] : []),
    ]
    const expert = state.expert
    if (!expert) return all
    let list = all
    if (expert.tools?.length) list = list.filter((t) => expert.tools!.includes(t.name))
    if (expert.disallowTools?.length) list = list.filter((t) => !expert.disallowTools!.includes(t.name))
    return list
  }

  /**
   * 运行一轮 Agent Loop
   * @param prompts 注入的用户消息（continue 模式为空数组）
   * @param attachments 本轮消息携带的图片附件（落盘描述；用于持久化 + 告诉模型图片位置）
   */
  private async runTurn(
    state: RuntimeSession,
    prompts: UserMessage[],
    isContinue: boolean,
    attachments: ChatAttachment[] = []
  ): Promise<void> {
    const sessionId = state.id
    const abortController = new AbortController()
    state.abortController = abortController

    // ---- 用户消息持久化 + 事件推送 ----
    // 首条用户消息: 异步生成 ≤10 字会话标题（不阻塞主 Loop）
    let isFirstUserMessage = state.messages.filter((m) => m.role === "user").length === 0
    for (const msg of prompts) {
      // 多模态消息取文本块（展示/落库/生成标题都只用用户原始输入，不含附件说明）
      const text = messageText(msg.content)
      state.messages.push(msg)
      this.db.message.insertUser(sessionId, text, attachments)
      this.pushEvent({
        type: "message.user",
        sessionId,
        id: randomUUID(),
        content: text,
        ts: Date.now(),
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      if (isFirstUserMessage && text.trim()) {
        void this.generateTitleAsync(state, text).catch(() => {})
        isFirstUserMessage = false
      }
    }
    // 附件说明注入 system prompt（图片 base64 已在消息里时只提示路径；模型无视觉能力时显式告知）
    const attachmentNote = attachments.length > 0 ? buildAttachmentNote(attachments, state.model) : null

    // ---- 任务轨迹（Agent Run）：本轮 loop 的全部思考/工具调用归属此 run，结束后渲染端收拢为摘要条 ----
    const runId = randomUUID()
    const runStartedAt = Date.now()
    let toolCallCount = 0
    this.db.agentRun.create(runId, sessionId, runStartedAt)
    this.pushEvent({ type: "run.started", sessionId, runId, ts: runStartedAt })

    // ---- 事件桥接状态 ----
    let currentAssistantId = ""
    let deltaBuffer = ""
    let thinkingBuffer = ""
    let lastFlush = 0
    let runError: string | null = null
    let aborted = false
    /** tool_execution_start 元数据，用于计算 durationMs + 历史恢复 args */
    const pendingTools = new Map<string, { startedAt: number; args: unknown }>()

    /** 推送 delta（30ms 节流；thinking 与正文共用节流时钟） */
    const flushDelta = (force = false) => {
      const now = Date.now()
      if (thinkingBuffer) {
        if (force || now - lastFlush >= DELTA_FLUSH_INTERVAL) {
          this.pushEvent({ type: "message.thinking.delta", sessionId, id: currentAssistantId, delta: thinkingBuffer })
          thinkingBuffer = ""
        }
      }
      if (!deltaBuffer) return
      if (!force && now - lastFlush < DELTA_FLUSH_INTERVAL) return
      this.pushEvent({ type: "message.assistant.delta", sessionId, id: currentAssistantId, delta: deltaBuffer })
      deltaBuffer = ""
      lastFlush = now
    }

    /** pi AgentEvent → Nexa AgentEvent 翻译 + DB 持久化 */
    const onPiEvent = (evt: PiAgentEvent): void => {
      switch (evt.type) {
        case "message_start": {
          if (evt.message.role === "assistant") {
            currentAssistantId = randomUUID()
            deltaBuffer = ""
            thinkingBuffer = ""
          }
          break
        }
        case "message_update": {
          if (evt.assistantMessageEvent.type === "text_delta") {
            deltaBuffer += evt.assistantMessageEvent.delta
            flushDelta()
          } else if (evt.assistantMessageEvent.type === "thinking_delta") {
            thinkingBuffer += evt.assistantMessageEvent.delta
            flushDelta()
          }
          break
        }
        case "message_end": {
          if (evt.message.role !== "assistant") break
          flushDelta(true)
          const msg = evt.message
          if (msg.stopReason === "aborted") {
            aborted = true
            break
          }
          const text = msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("")
          const thinking = msg.content
            .filter((c): c is { type: "thinking"; thinking: string } => c.type === "thinking")
            .map((c) => c.thinking)
            .join("")
          // DB 持久化
          this.db.message.insertAssistant(sessionId, text, msg.usage, thinking || undefined, runId)
          if (msg.stopReason === "error") {
            runError = msg.errorMessage ?? "LLM 调用失败"
            this.pushEvent({ type: "error", sessionId, code: "llm_error", message: runError })
          } else {
            this.pushEvent({
              type: "message.assistant.done",
              sessionId,
              id: currentAssistantId,
              content: text,
              thinking: thinking || undefined,
            })
          }
          break
        }
        case "tool_execution_start": {
          pendingTools.set(evt.toolCallId, { startedAt: Date.now(), args: evt.args })
          toolCallCount += 1
          this.db.toolCall.insert(evt.toolCallId, sessionId, evt.toolName, evt.args ?? {}, runId)
          this.pushEvent({
            type: "tool.call",
            sessionId,
            toolName: evt.toolName,
            args: evt.args,
            callId: evt.toolCallId,
            ts: Date.now(),
          })
          break
        }
        case "tool_execution_end": {
          const pending = pendingTools.get(evt.toolCallId)
          const startedAt = pending?.startedAt ?? Date.now()
          const durationMs = Date.now() - startedAt
          this.db.toolCall.updateResult(evt.toolCallId, evt.result ?? null, !evt.isError, durationMs)
          // 补 messages 表 tool role 消息，历史加载时可恢复 ToolCallBubble
          this.db.message.insertTool(sessionId, evt.toolName, evt.toolCallId, evt.result, !evt.isError, durationMs, pending?.args, runId)
          pendingTools.delete(evt.toolCallId)
          this.pushEvent({
            type: "tool.result",
            sessionId,
            callId: evt.toolCallId,
            success: !evt.isError,
            result: evt.result,
            durationMs,
          })
          break
        }
        default:
          // agent_start / agent_end / turn_start / turn_end 不需要桥接
          break
      }
    }

    // ---- 运行 loop ----
    const tools = this.resolveTools(state)
    const context = {
      systemPrompt: this.buildSystemPrompt(state, tools.map((t) => t.name), attachmentNote),
      messages: state.messages,
      tools,
    }
    const config = {
      model: state.model,
      apiKey: getApiKey(state.model.provider),
      // 仅对支持推理的模型开启思考（DeepSeek V4 等），映射为请求参数 thinking={type:"enabled"}；
      // 否则 pi-ai 会向不支持 thinking 的 API 传 reasoning 参数
      reasoning: (state.model as { reasoning?: boolean }).reasoning ? "medium" : undefined,
      // 上下文只含标准 user/assistant/toolResult 消息，直接透传
      convertToLlm: (messages: AgentMessage[]) => messages as PiMessage[],
    } as const

    try {
      const newMessages = isContinue
        ? await runAgentLoopContinue(context, config, onPiEvent, abortController.signal)
        : await runAgentLoop(prompts, context, config, onPiEvent, abortController.signal)

      // 消息合并（pi loop 的 context 语义见下）:
      // - runAgentLoop 复制 context.messages，返回 [...prompts, ...产出]，需手动合并
      // - runAgentLoopContinue 共享 messages 引用，产出已直接写入 state.messages
      if (isContinue) {
        // continue 后检查尾部是否为 aborted assistant（pause 场景），若是则移除保持上下文可续跑
        const last = state.messages[state.messages.length - 1]
        if (last?.role === "assistant" && last.stopReason === "aborted") {
          aborted = true
          state.messages.pop()
        }
      } else {
        const produced = newMessages.slice(prompts.length)
        for (const m of produced) {
          if (m.role === "assistant" && m.stopReason === "aborted") {
            aborted = true
            continue
          }
          state.messages.push(m)
        }
      }
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err)
      this.pushEvent({ type: "error", sessionId, code: "runtime_error", message: runError })
    }

    // ---- 收尾状态 ----
    let finalStatus: SessionStatus
    if (aborted) {
      finalStatus = "paused"
    } else if (runError) {
      finalStatus = "failed"
    } else {
      finalStatus = "completed"
    }
    state.status = finalStatus
    this.db.session.updateStatus(sessionId, finalStatus)
    this.pushEvent({ type: "session.status", sessionId, status: finalStatus })
    state.abortController = null

    // ---- 任务轨迹收尾：渲染端据此把本轮思考/工具调用收拢为「任务耗时」摘要条 ----
    const runFinishedAt = Date.now()
    const runStatus = finalStatus as "completed" | "failed" | "paused"
    this.db.agentRun.finish(runId, runStatus, runFinishedAt, runFinishedAt - runStartedAt, toolCallCount)
    this.pushEvent({
      type: "run.finished",
      sessionId,
      runId,
      status: runStatus,
      durationMs: runFinishedAt - runStartedAt,
      toolCallCount,
    })

    // 记忆提取：每 5 轮触发一次（后台，不阻塞会话状态）
    if (finalStatus === "completed") {
      void this.memory.tick(sessionId, state.messages).catch(() => {})
    }
  }

  /**
   * 首条用户消息后异步生成 ≤12 字会话标题。
   * 复用 pi 的 generateSummary 做一次轻量 LLM 调用，返回后经 normalizeTitle 清洗校验，
   * 成功后 rename 落库并推送 session.title 事件。
   * 任何失败或清洗后不可用（如模型照抄出 "## Goal - "）时静默忽略，保留创建时的兜底标题。
   */
  private async generateTitleAsync(state: RuntimeSession, firstMessage: string): Promise<void> {
    // provider 被禁用或未配置 key 时 getApiKey 返回 undefined，无法调用 LLM，保留兜底标题
    const apiKey = getApiKey(state.model.provider)
    if (!apiKey) return
    const result = await generateSummary(
      [
        {
          role: "user",
          content: `【任务描述开始】\n${firstMessage.slice(0, 2000)}\n【任务描述结束】`,
          timestamp: Date.now(),
        } as AgentMessage,
      ],
      state.model,
      0,
      apiKey,
      undefined,
      undefined,
      TITLE_SYSTEM_PROMPT,
    )
    if (!result.ok) return
    // 模型可能忽略约束照抄原文的 Markdown 结构，必须清洗并做有效性校验
    const title = normalizeTitle(result.value, 12)
    if (!title) return
    this.db.session.rename(state.id, title)
    this.pushEvent({ type: "session.title", sessionId: state.id, title })
  }
}
