import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Markdown from "react-native-markdown-display"
import * as Clipboard from "expo-clipboard"
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Plus,
  Wrench,
  X,
} from "lucide-react-native"
import { useTheme, useChatFontSize, type ThemeColors } from "@/lib/theme"
import { useRelayStore, type RunMeta } from "@/lib/relay/service"
import { pickAndCompressImages, type PickedImage } from "@/lib/image-picker"
import type { ArtifactItem, ChatMessage, TokenUsage } from "@/lib/relay/protocol"

/** 稳定的空数组引用：zustand v5 + useSyncExternalStore 下，选择器每次返回新建 []
 * 会导致快照永远变化 → 无限重渲染 → Maximum update depth 崩溃（点进详情必崩的根因） */
const EMPTY_MESSAGES: ChatMessage[] = []
/** 产物列表的空引用（同理，避免选择器每次返回新数组导致无限重渲染） */
const EMPTY_ARTIFACTS: ArtifactItem[] = []
/** 历史轨迹的空引用（同上） */
const EMPTY_RUNS: Record<string, RunMeta> = {}

/** 应用图标（消息头部头像，对齐桌面端用应用 Logo） */
const APP_ICON = require("../../../assets/icon.png")

// ==========================================
// 任务轨迹（对齐桌面端 ai-elements Task）
// 一条 user 消息触发的一轮 agent loop 为一个任务组；
// 执行过程收进最终回答：头像+Nexa 下方一行灰色「已完成 42s ›」，点击展开，
// 运行中默认展开、结束后自动收拢，最终回答常显。
// ==========================================

interface RunGroupData {
  key: string
  user: ChatMessage | null
  items: ChatMessage[]
}

/** 按 user 消息切分任务组 */
function buildRunGroups(messages: ChatMessage[]): RunGroupData[] {
  const groups: RunGroupData[] = []
  let current: RunGroupData | null = null
  for (const m of messages) {
    if (m.role === "user") {
      current = { key: `run-${m.id}`, user: m, items: [] }
      groups.push(current)
    } else {
      if (!current) {
        current = { key: `run-pre-${m.id}`, user: null, items: [] }
        groups.push(current)
      }
      current.items.push(m)
    }
  }
  return groups
}

/** 耗时格式化：42s / 2m30s / 1h05m（与桌面端一致） */
function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const mins = Math.floor(total / 60)
  const secs = total % 60
  if (mins < 60) return `${mins}m${String(secs).padStart(2, "0")}s`
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`
}

/** token 数量格式化：946 / 5.5k / 1.3M（与桌面端一致） */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

/** provider/modelId → 显示名（与桌面端 formatModelName 保持同步） */
function formatModelName(model?: string | null): string | null {
  if (!model) return null
  const map: Record<string, string> = {
    "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
    "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek/deepseek-v3.2": "DeepSeek V3.2",
  }
  return map[model] ?? model.split("/").pop() ?? model
}

/** token 用量 → 总数（历史数据可能只有 input/output） */
function totalTokensOf(usage?: TokenUsage | null): number {
  if (!usage) return 0
  return usage.totalTokens ?? (usage.input ?? 0) + (usage.output ?? 0)
}

/** 消息时间：今天 HH:mm / 昨天 HH:mm / M/D HH:mm（兼容秒级与毫秒级时间戳） */
function formatMessageTime(input?: number): string {
  if (!input) return ""
  const ms = input < 1e12 ? input * 1000 : input
  const d = new Date(ms)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

/** 历史数据无 run 事件：用组内消息时间戳（秒）合成轨迹元数据 */
function synthMeta(items: ChatMessage[], toolCount: number): RunMeta {
  const first = items[0]?.createdAt
  const last = items[items.length - 1]?.createdAt
  return {
    startedAt: first ? first * 1000 : 0,
    status: "completed",
    durationMs: first && last ? Math.max(0, (last - first) * 1000) : 0,
    toolCallCount: toolCount,
  }
}

/** 轨迹折叠条：一行灰色小字「已完成 42s ›」 */
function TraceBar({
  status,
  durationLabel,
  colors: t,
  children,
}: {
  status: RunMeta["status"]
  durationLabel: string | null
  colors: ThemeColors
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(status === "running")
  const prevStatus = useRef(status)
  useEffect(() => {
    // 运行中自动展开；收到结束事件时自动收拢（对齐桌面端）
    if (status === "running") setOpen(true)
    else if (prevStatus.current === "running") setOpen(false)
    prevStatus.current = status
  }, [status])

  const label =
    status === "running"
      ? "执行中"
      : status === "failed"
        ? "失败"
        : status === "paused"
          ? "已暂停"
          : "已完成"

  const s = useMemo(
    () =>
      StyleSheet.create({
        bar: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 2 },
        text: { color: t.textMuted, fontSize: 11 },
        body: {
          gap: 8,
          marginTop: 2,
          paddingLeft: 10,
          borderLeftWidth: 1,
          borderLeftColor: t.border,
        },
      }),
    [t]
  )

  return (
    <>
      <Pressable style={s.bar} onPress={() => setOpen((v) => !v)} accessibilityLabel="展开或收起任务轨迹">
        <Text style={s.text}>
          {label}
          {status !== "running" && durationLabel ? ` ${durationLabel}` : ""}
        </Text>
        {open ? <ChevronDown size={12} color={t.textMuted} /> : <ChevronRight size={12} color={t.textMuted} />}
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </>
  )
}

/** 思考过程：流式中自动展开，正文到达后延迟收拢（对齐桌面端 Reasoning） */
function ThoughtBlock({
  text,
  streaming,
  colors: t,
}: {
  text: string
  streaming: boolean
  colors: ThemeColors
}) {
  const [open, setOpen] = useState(streaming)
  const wasStreaming = useRef(streaming)
  useEffect(() => {
    if (streaming) {
      wasStreaming.current = true
      setOpen(true)
      return
    }
    if (!wasStreaming.current) return
    wasStreaming.current = false
    const timer = setTimeout(() => setOpen(false), 600)
    return () => clearTimeout(timer)
  }, [streaming])

  const s = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: 3 },
        head: { flexDirection: "row", alignItems: "center", gap: 3 },
        title: { color: t.textMuted, fontSize: 11 },
        body: {
          marginTop: 2,
          paddingLeft: 8,
          borderLeftWidth: 2,
          borderLeftColor: t.border,
        },
        text: { color: t.textMuted, fontSize: 11, lineHeight: 17 },
      }),
    [t]
  )

  return (
    <View style={s.wrap}>
      <Pressable style={s.head} onPress={() => setOpen((v) => !v)} accessibilityLabel="展开或收起思考过程">
        <Text style={s.title}>{streaming ? "思考中…" : "思考过程"}</Text>
        {open ? <ChevronDown size={12} color={t.textMuted} /> : <ChevronRight size={12} color={t.textMuted} />}
      </Pressable>
      {open ? (
        <View style={s.body}>
          <Text style={s.text}>{text}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** 工具调用：弱化一行（图标 + 名称 + 状态），点开看输出 */
function ToolRow({
  name,
  content,
  isError,
  colors: t,
}: {
  name: string
  content: string
  isError: boolean
  colors: ThemeColors
}) {
  const [open, setOpen] = useState(false)
  const s = useMemo(
    () =>
      StyleSheet.create({
        row: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3 },
        name: { color: t.textMuted, fontSize: 11 },
        state: { color: isError ? t.danger : t.textMuted, fontSize: 11, marginLeft: 2 },
        out: {
          marginTop: 2,
          paddingLeft: 8,
          borderLeftWidth: 2,
          borderLeftColor: t.border,
          color: t.textMuted,
          fontSize: 11,
          lineHeight: 16,
          fontFamily: "Menlo",
        },
      }),
    [t, isError]
  )

  return (
    <View>
      <Pressable style={s.row} onPress={() => setOpen((v) => !v)} accessibilityLabel={`展开工具 ${name} 输出`}>
        <Wrench size={12} color={t.textMuted} />
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        {isError ? <Text style={s.state}>· 失败</Text> : null}
        {open ? <ChevronDown size={12} color={t.textMuted} /> : <ChevronRight size={12} color={t.textMuted} />}
      </Pressable>
      {open && content ? <Text style={s.out}>{content}</Text> : null}
    </View>
  )
}

/** Markdown 配色（对齐桌面端）：入参为当前主题色 + 消息字号（设置页字体设置，12/14/16） */
function makeMdStyles(t: ThemeColors, size: number) {
  return {
    body: { color: t.text, fontSize: size, lineHeight: Math.round(size * 1.5) },
    strong: { color: t.text, fontWeight: "700" },
    em: { color: t.text },
    heading1: { color: t.text, fontSize: size + 3.5, fontWeight: "700", marginTop: 8, marginBottom: 4 },
    heading2: { color: t.text, fontSize: size + 2, fontWeight: "700", marginTop: 8, marginBottom: 4 },
    heading3: { color: t.text, fontSize: size + 1, fontWeight: "600", marginTop: 6, marginBottom: 3 },
    link: { color: t.accent },
    bullet_list: { marginTop: 4, marginBottom: 4 },
    ordered_list: { marginTop: 4, marginBottom: 4 },
    list_item: { marginBottom: 2 },
    // 行内代码黄色在两种主题下都可读，保持不变
    code_inline: {
      color: "#fbbf24",
      backgroundColor: "rgba(251,191,36,0.10)",
      fontFamily: "Menlo",
      fontSize: size - 1.5,
    },
    fence: {
      backgroundColor: t.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      color: t.textSecondary,
      fontFamily: "Menlo",
      fontSize: size - 2,
    },
    blockquote: { backgroundColor: t.accentSoft, borderLeftColor: t.accent, borderLeftWidth: 3 },
    hr: { backgroundColor: t.border },
  } as const
}

export default function SessionScreen() {
  const { colors: t } = useTheme()
  // 消息字号（设置页字体设置，仅作用于本页消息正文）
  const chatFontSize = useChatFontSize((s) => s.size)
  const params = useLocalSearchParams()
  const router = useRouter()
  // 底部手势条高度：输入框需避开该区域，否则会被系统手势条/SafeArea 压住一部分
  const insets = useSafeAreaInsets()
  const sessionId = String(params.id ?? "")
  /** 标题用具体任务名（来自会话列表；未加载到则回退通用标题），超长由导航栏单行省略号截断 */
  const sessionTitle = useRelayStore((s) => s.sessions.find((x) => x.id === sessionId)?.title || "任务详情")

  const status = useRelayStore((s) => s.status)
  const allMessages = useRelayStore((s) => s.messages[sessionId]) ?? EMPTY_MESSAGES
  // 手机端展示顺序：用户/助手为主，思考与工具调用弱化展示（小字灰色），system 跳过
  const messages = useMemo(() => allMessages.filter((m) => m.role !== "system"), [allMessages])
  // 按用户消息切分任务组（每组一条摘要条收拢过程）
  const groups = useMemo(() => buildRunGroups(messages), [messages])
  // 最近一轮的轨迹元数据（耗时/工具数/状态）
  const runMeta = useRelayStore((s) => s.runMeta[sessionId])
  // 历史轨迹（runId → 元数据，来自 agent_runs）
  const historicRuns = useRelayStore((s) => s.historicRuns[sessionId]) ?? EMPTY_RUNS
  const loadMessages = useRelayStore((s) => s.loadMessages)
  const sendMessage = useRelayStore((s) => s.sendMessage)

  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  /** 刚复制过的消息 id（1.5s 内显示对勾反馈） */
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // 待发送图片附件（+ 号选图，随消息上传；桌面端落盘后可由 Agent 收藏入知识库）
  const [pendingImages, setPendingImages] = useState<PickedImage[]>([])
  const [picking, setPicking] = useState(false)
  const listRef = useRef<FlatList<RunGroupData>>(null)

  // 任务产物（md/html 文档卡，点击预览）
  const artifacts = useRelayStore((s) => s.artifacts[sessionId]) ?? EMPTY_ARTIFACTS
  // 消息是否仍在加载：加载期间不展示产物区，避免「先出产物、后出消息」的错位感
  const messagesLoading = useRelayStore((s) => s.loadingMessages[sessionId] === true)
  const loadArtifacts = useRelayStore((s) => s.loadArtifacts)
  useEffect(() => {
    if (sessionId) void loadArtifacts(sessionId)
  }, [sessionId, loadArtifacts])

  useEffect(() => {
    if (sessionId) void loadMessages(sessionId)
  }, [sessionId, loadMessages])

  // 消息加载完成后默认滚到最新一条（每个会话只做一次，之后不打断用户回看历史）
  const didInitialScroll = useRef(false)
  useEffect(() => {
    didInitialScroll.current = false
  }, [sessionId])
  useEffect(() => {
    if (messagesLoading || groups.length === 0 || didInitialScroll.current) return
    didInitialScroll.current = true
    // 等一帧布局完成再滚：消息里的 Markdown/表格高度要测量后才准，否则会停在中间
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60)
    return () => clearTimeout(timer)
  }, [messagesLoading, groups.length])

  // 被解绑 → 回任务首页
  useEffect(() => {
    if (!status.connected) router.replace("/(tabs)")
  }, [status.connected, router])

  /** 相册选图（压缩逻辑见 lib/image-picker） */
  const pickImages = useCallback(async () => {
    if (picking) return
    setPicking(true)
    try {
      const next = await pickAndCompressImages()
      if (!next) return
      setPendingImages((prev) => [...prev, ...next].slice(0, 3))
    } catch (e) {
      Alert.alert("选择图片失败", e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }, [picking])

  const handleSend = useCallback(async () => {
    const body = text.trim()
    // 允许仅发图片（与桌面端粘贴图片直接发送对齐）
    if ((!body && pendingImages.length === 0) || sending) return
    setSending(true)
    try {
      await sendMessage(
        sessionId,
        body,
        pendingImages.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl }))
      )
      setText("")
      setPendingImages([])
    } catch (e) {
      Alert.alert("发送失败", e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [text, pendingImages, sending, sendMessage, sessionId])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        listContent: { padding: 12, gap: 14 },
        // 任务组：组内间距略小，组间由 listContent.gap 控制
        group: { gap: 8 },
        empty: { padding: 40, alignItems: "center" },
        /* 用户消息：右侧实底气泡（对齐桌面端，助手消息不再套气泡） */
        userRow: { flexDirection: "row", justifyContent: "flex-end" },
        userBubble: {
          maxWidth: "82%",
          borderRadius: 16,
          borderTopRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: t.bubbleUser,
        },
        userText: { fontSize: chatFontSize, lineHeight: Math.round(chatFontSize * 1.4), color: t.bubbleUserText },
        /* 助手消息：文档式排版，头像与 Nexa 同一行 */
        assistantBlock: { gap: 4 },
        headerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
        avatar: { width: 18, height: 18, borderRadius: 5 },
        name: { color: t.text, fontSize: 12, fontWeight: "600" },
        /* 底栏：时间 · 模型 · token（灰色小字，与桌面端一致） */
        metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 2 },
        metaText: { color: t.textMuted, fontSize: 10 },
        composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: t.border },
        input: {
          flex: 1, backgroundColor: t.card, color: t.text, borderRadius: 12, paddingHorizontal: 14,
          paddingVertical: 10, fontSize: 15, maxHeight: 120,
        },
        // 发送按钮：圆形图标按钮（与桌面端/常见 IM 一致）
        sendBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: t.accent,
          alignItems: "center",
          justifyContent: "center",
        },
        btnDisabled: { opacity: 0.5 },
        // + 号选图按钮（与输入框同高对齐）
        plusBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.card, alignItems: "center", justifyContent: "center" },
        // 待发送图片缩略图行
        thumbRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
        thumbWrap: { width: 56, height: 56, borderRadius: 8, overflow: "hidden" },
        thumb: { width: 56, height: 56 },
        thumbRemove: { position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
        // 消息气泡内的图片附件
        attRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
        attImage: { width: 180, height: 135, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.10)" },
        attFallback: { alignItems: "center", justifyContent: "center", padding: 8 },
        attFallbackText: { color: t.bubbleUserText, fontSize: 11 },
        // 任务产物文件卡（左侧与消息气泡对齐，外边距由列表 padding 提供）
        artifactWrap: { marginTop: 4, gap: 8 },
        artifactCard: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: t.card,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
        },
        artifactBody: { flex: 1, gap: 2 },
        artifactName: { color: t.text, fontSize: 13, fontWeight: "500" },
        artifactMeta: { color: t.textMuted, fontSize: 11 },
      }),
    [t, chatFontSize]
  )
  const mdStyles = useMemo(() => makeMdStyles(t, chatFontSize), [t, chatFontSize])

  /** assistant 正文：Markdown 渲染（流式期间也安全——内容逐步追加） */
  const assistantBody = useCallback((content: string) => {
    return (
      <Markdown style={mdStyles}>
        {content}
      </Markdown>
    )
  }, [mdStyles])

  /** 复制助手消息正文到系统剪贴板（1.5s 后恢复图标） */
  const copyMessage = useCallback(async (id: string, content: string) => {
    await Clipboard.setStringAsync(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1500)
  }, [])

  /**
   * 单条消息（对齐桌面端 MessageBubble）
   * - 用户：右侧实底气泡
   * - 助手：顶部「Logo + Nexa」→ 轨迹折叠条 → 思考过程 → 正文 → 底栏（时间/模型/token）
   * - 工具：弱化一行，点击展开输出
   * embedded=true 表示消息位于轨迹展开区内部（不重复头像/底栏）
   */
  const renderMessage = (
    item: ChatMessage,
    trace?: { status: RunMeta["status"]; durationLabel: string | null; children: ChatMessage[] },
    embedded = false,
    artifactList?: ArtifactItem[]
  ) => {
    if (item.role === "tool") {
      return (
        <ToolRow
          key={item.id}
          name={item.toolName ?? "tool"}
          content={String(item.content ?? "")}
          isError={!!item.isError}
          colors={t}
        />
      )
    }

    if (item.role === "user") {
      return (
        <View key={item.id} style={styles.userRow}>
          <View style={styles.userBubble}>
            {/* 图片附件（session:messages 下发 dataUrl；超限未带 dataUrl 时显示文件名占位） */}
            {item.attachments?.length ? (
              <View style={styles.attRow}>
                {item.attachments.map((a, i) =>
                  a.dataUrl ? (
                    <Image key={`${item.id}-att-${i}`} source={{ uri: a.dataUrl }} style={styles.attImage} resizeMode="cover" />
                  ) : (
                    <View key={`${item.id}-att-${i}`} style={[styles.attImage, styles.attFallback]}>
                      <Text style={styles.attFallbackText} numberOfLines={2}>{a.name}</Text>
                    </View>
                  )
                )}
              </View>
            ) : null}
            {item.content ? <Text style={styles.userText}>{String(item.content)}</Text> : null}
          </View>
        </View>
      )
    }

    // 助手消息
    const body = String(item.content ?? "")
    // 仅流式中的消息带 done=false；历史消息没有该字段，不能当作流式
    const streaming = item.done === false
    const timeLabel = formatMessageTime(item.createdAt)
    const modelLabel = formatModelName(item.model)
    const total = totalTokensOf(item.usage)
    const metaParts = [timeLabel, modelLabel, total > 0 ? `${formatTokens(total)} tokens` : ""].filter(Boolean)

    return (
      <View key={item.id} style={embedded ? undefined : styles.assistantBlock}>
        {!embedded ? (
          <View style={styles.headerRow}>
            <Image source={APP_ICON} style={styles.avatar} resizeMode="cover" />
            <Text style={styles.name}>Nexa</Text>
          </View>
        ) : null}
        {trace ? (
          <TraceBar status={trace.status} durationLabel={trace.durationLabel} colors={t}>
            {trace.children.map((m) => renderMessage(m, undefined, true))}
          </TraceBar>
        ) : null}
        {item.thinking ? (
          <ThoughtBlock text={String(item.thinking)} streaming={streaming && !body} colors={t} />
        ) : null}
        {body ? assistantBody(body) : null}
        {/* 任务产物卡：与桌面端一致，放在最终回答正文之后、时间/模型/token 底栏之前 */}
        {!embedded && artifactList?.length ? (
          <View style={styles.artifactWrap}>
            {artifactList.map((a) => (
              <Pressable
                key={a.relPath}
                style={styles.artifactCard}
                onPress={() =>
                  router.push(`/artifact/${sessionId}?path=${encodeURIComponent(a.relPath)}&name=${encodeURIComponent(a.name)}`)
                }
                accessibilityLabel={`预览 ${a.name}`}
              >
                <FileText size={18} color={t.accent} />
                <View style={styles.artifactBody}>
                  <Text style={styles.artifactName} numberOfLines={1}>{a.name}</Text>
                  <Text style={styles.artifactMeta} numberOfLines={1}>{a.relPath}</Text>
                </View>
                <ChevronRight size={16} color={t.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {/* 底栏：复制图标 + 时间 · 模型 · token（与桌面端 MessageActions 顺序一致） */}
        {!embedded && !streaming && body ? (
          <View style={styles.metaRow}>
            <Pressable
              onPress={() => void copyMessage(item.id, body)}
              hitSlop={8}
              accessibilityLabel="复制消息内容"
            >
              {copiedId === item.id ? (
                <Check size={12} color={t.textMuted} />
              ) : (
                <Copy size={12} color={t.textMuted} />
              )}
            </Pressable>
            {metaParts.length > 0 ? <Text style={styles.metaText}>{metaParts.join(" · ")}</Text> : null}
          </View>
        ) : null}
      </View>
    )
  }

  /**
   * 任务组：用户消息 → 最终回答（内嵌轨迹条）→ 常显正文
   * 运行中 / 无最终回答：轨迹条独立展示
   * 无工具调用的普通问答不显示轨迹条（对齐桌面端 RunGroupView）
   */
  const renderGroup = ({ item: group }: { item: RunGroupData }) => {
    // 过滤纯工具轮次落库的空 assistant 行
    const items = group.items.filter(
      (m) => !(m.role === "assistant" && !String(m.content ?? "").trim() && !m.thinking)
    )
    const toolCount = items.filter((m) => m.role === "tool").length
    // 优先用 agent_runs 的真实耗时（组内消息带 runId）；没有则用最后一轮事件、再退回消息时间差
    const runId = items.find((m) => m.runId)?.runId ?? null
    const historic = runId ? historicRuns[runId] : undefined
    const isLast = group.key === groups[groups.length - 1]?.key
    const live = isLast ? runMeta : undefined
    const meta: RunMeta = historic ?? live ?? synthMeta(items, toolCount)
    const running = (historic?.status ?? live?.status) === "running"

    // 最终回答：完成后取最后一条有正文的 assistant 常显；运行中全部留在展开区避免时序错位
    let finalIdx = -1
    if (!running) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].role === "assistant" && String(items[i].content ?? "").trim()) {
          finalIdx = i
          break
        }
      }
    }

    const trace =
      toolCount > 0
        ? {
            // 运行中保持 running；结束后用历史/实时状态
            status: (running ? "running" : meta.status) as RunMeta["status"],
            durationLabel: !running && meta.durationMs != null ? formatRunDuration(meta.durationMs) : null,
            children: items.filter((_, i) => i !== finalIdx),
          }
        : null

    // 产物卡挂在最后一轮的最终回答上（对齐桌面端 artifactAnchorId：正文之后、底栏之前）
    const anchorId = isLast && !messagesLoading && artifacts.length > 0 ? items[finalIdx]?.id : undefined

    return (
      <View style={styles.group}>
        {group.user ? renderMessage(group.user) : null}
        {toolCount === 0 ? (
          items.map((m) => renderMessage(m, undefined, false, m.id === anchorId ? artifacts : undefined))
        ) : finalIdx >= 0 ? (
          renderMessage(items[finalIdx], trace ?? undefined, false, anchorId ? artifacts : undefined)
        ) : (
          // 运行中 / 无最终回答：轨迹条独立展示在用户消息之后
          trace && (
            <TraceBar status={trace.status} durationLabel={trace.durationLabel} colors={t}>
              {trace.children.map((m) => renderMessage(m, undefined, true))}
            </TraceBar>
          )
        )}
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      {/* 导航栏标题：具体任务名（随会话标题变化） */}
      <Stack.Screen options={{ title: sessionTitle }} />
      <FlatList
        ref={listRef}
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.empty}>
            {messagesLoading ? <ActivityIndicator color={t.accent} /> : null}
          </View>
        }
        renderItem={renderGroup}
      />

      <View>
        {/* 待发送图片缩略图（可点 x 移除） */}
        {pendingImages.length > 0 && (
          <View style={styles.thumbRow}>
            {pendingImages.map((img, i) => (
              <View key={img.previewUri} style={styles.thumbWrap}>
                <Image source={{ uri: img.previewUri }} style={styles.thumb} />
                <Pressable
                  style={styles.thumbRemove}
                  onPress={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                  accessibilityLabel="移除图片"
                >
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={[styles.composer, { paddingBottom: 12 + insets.bottom }]}>
          <Pressable style={styles.plusBtn} onPress={() => void pickImages()} disabled={picking} accessibilityLabel="添加图片">
            {picking ? <ActivityIndicator size="small" color={t.textMuted} /> : <Plus size={20} color={t.textMuted} />}
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="输入消息…"
            placeholderTextColor={t.textMuted}
            multiline
          />
          <Pressable
            style={[styles.sendBtn, ((!text.trim() && pendingImages.length === 0) || sending) && styles.btnDisabled]}
            onPress={handleSend}
            disabled={(!text.trim() && pendingImages.length === 0) || sending}
            accessibilityLabel="发送"
            android_ripple={{ color: "transparent" }}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <ArrowUp size={20} color="#fff" strokeWidth={2.4} />}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

/** 路由级错误边界：渲染异常时显示错误信息而非白屏/闪退，便于拿到崩溃现场 */
export function ErrorBoundary({ error }: { error: Error }) {
  const { colors: t } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: t.danger, fontSize: 16, fontWeight: "600", marginBottom: 8 }}>页面出错了</Text>
      <Text style={{ color: t.textMuted, fontSize: 12, textAlign: "center" }}>{String(error?.message ?? error)}</Text>
    </View>
  )
}
