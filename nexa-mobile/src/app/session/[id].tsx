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
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Pause,
  Plus,
  Terminal,
  X,
  XCircle,
} from "lucide-react-native"
import { useTheme, useChatFontSize, type ThemeColors } from "@/lib/theme"
import { useRelayStore, type RunMeta } from "@/lib/relay/service"
import { pickAndCompressImages, type PickedImage } from "@/lib/image-picker"
import type { ArtifactItem, ChatMessage } from "@/lib/relay/protocol"

/** 稳定的空数组引用：zustand v5 + useSyncExternalStore 下，选择器每次返回新建 []
 * 会导致快照永远变化 → 无限重渲染 → Maximum update depth 崩溃（点进详情必崩的根因） */
const EMPTY_MESSAGES: ChatMessage[] = []
/** 产物列表的空引用（同理，避免选择器每次返回新数组导致无限重渲染） */
const EMPTY_ARTIFACTS: ArtifactItem[] = []
/** 历史轨迹的空引用（同上） */
const EMPTY_RUNS: Record<string, RunMeta> = {}

// ==========================================
// 任务轨迹（对齐桌面端 RunTrace）
// 一条 user 消息触发的一轮 agent loop 为一个任务组；
// 结束后思考/工具调用收拢成「任务耗时 X分Y秒 · N 次工具调用」摘要条，最终回答常显。
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

/** 耗时格式化：59秒 / 2分30秒 / 1小时05分（与桌面端一致） */
function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}秒`
  const mins = Math.floor(total / 60)
  const secs = total % 60
  if (mins < 60) return `${mins}分${secs}秒`
  return `${Math.floor(mins / 60)}小时${String(mins % 60).padStart(2, "0")}分`
}

/** 轨迹摘要条：运行中默认展开，结束后自动收拢 */
function RunTrace({
  meta,
  running,
  toolCount,
  colors: t,
  children,
}: {
  meta: RunMeta
  running: boolean
  toolCount: number
  colors: ThemeColors
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(running)
  const prevRunning = useRef(running)
  useEffect(() => {
    // 运行中展开跟随，收到结束事件时自动收拢（对齐桌面端）
    if (prevRunning.current && !running) setOpen(false)
    prevRunning.current = running
  }, [running])

  const failed = meta.status === "failed"
  const paused = meta.status === "paused"
  const title = running ? "任务执行中…" : failed ? "任务失败" : paused ? "任务已暂停" : "任务耗时"
  const duration = !running && meta.durationMs != null ? formatRunDuration(meta.durationMs) : null

  const s = useMemo(
    () =>
      StyleSheet.create({
        bar: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: "rgba(115,115,115,0.08)",
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
        title: { color: t.textSecondary, fontSize: 12, fontWeight: "600" },
        duration: { color: t.textMuted, fontSize: 12 },
        tools: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto", paddingLeft: 8 },
        toolsText: { color: t.textMuted, fontSize: 11 },
        body: { gap: 8, marginTop: 8 },
      }),
    [t]
  )

  const statusIcon = running ? (
    <Loader2 size={13} color={t.accent} />
  ) : failed ? (
    <XCircle size={13} color={t.danger} />
  ) : paused ? (
    <Pause size={13} color="#f59e0b" />
  ) : (
    <CheckCircle2 size={13} color={t.success} />
  )

  return (
    <>
      <Pressable style={s.bar} onPress={() => setOpen((v) => !v)} accessibilityLabel="展开或收起任务轨迹">
        {open ? <ChevronDown size={13} color={t.textMuted} /> : <ChevronRight size={13} color={t.textMuted} />}
        {statusIcon}
        <Text style={s.title}>{title}</Text>
        {duration ? <Text style={s.duration}>{duration}</Text> : null}
        <View style={s.tools}>
          <Terminal size={11} color={t.textMuted} />
          <Text style={s.toolsText}>{toolCount} 次工具调用</Text>
        </View>
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </>
  )
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

/** Markdown 配色（对齐桌面端）：入参为当前主题色 + 消息字号（设置页字体设置，12/14/16） */
function makeMdStyles(t: ThemeColors, size: number) {
  return {
    body: { color: t.textSecondary, fontSize: size, lineHeight: Math.round(size * 1.5) },
    strong: { color: t.text, fontWeight: "700" },
    em: { color: t.textSecondary },
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
  // 待发送图片附件（+ 号选图，随消息上传；桌面端落盘后可由 Agent 收藏入知识库）
  const [pendingImages, setPendingImages] = useState<PickedImage[]>([])
  const [picking, setPicking] = useState(false)
  // 思考过程 / 工具调用的展开集合（默认全部收拢）
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const listRef = useRef<FlatList<RunGroupData>>(null)

  const toggleTrace = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

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
        /* 思考过程：弱化（小字/灰色/半透明块），默认收拢 */
        thinkingBlock: {
          backgroundColor: "rgba(115,115,115,0.12)",
          borderLeftColor: t.textMuted,
          borderLeftWidth: 2,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 6,
          marginBottom: 8,
        },
        thinkingTitle: { color: t.textMuted, fontSize: 12, fontWeight: "600" },
        thinkingText: { color: t.textMuted, fontSize: 12, lineHeight: 18, fontStyle: "italic", marginTop: 4 },
        /* 工具调用：弱化 + 可展开（位于轨迹展开区内，左缘与消息对齐） */
        traceBlock: {
          alignSelf: "stretch",
          marginVertical: 2,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 8,
          backgroundColor: "rgba(115,115,115,0.08)",
        },
        traceHead: { flexDirection: "row", alignItems: "center", gap: 4 },
        traceTitle: { color: t.textMuted, fontSize: 11, fontWeight: "600" },
        traceText: { color: t.textMuted, fontSize: 11, lineHeight: 16, fontFamily: "Menlo", marginTop: 4 },
        container: { flex: 1, backgroundColor: t.bg },
        listContent: { padding: 12, gap: 10 },
        // 任务组：组内间距略小，组间由 listContent.gap 控制
        group: { gap: 8 },
        empty: { padding: 40, alignItems: "center" },
        bubbleRow: { flexDirection: "row" },
        bubbleRowRight: { justifyContent: "flex-end" },
        bubbleRowLeft: { justifyContent: "flex-start" },
        bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
        bubbleUser: { backgroundColor: t.bubbleUser },
        bubbleAssistant: { backgroundColor: t.border },
        bubbleText: { fontSize: chatFontSize, lineHeight: Math.round(chatFontSize * 1.4) },
        bubbleTextUser: { color: t.bubbleUserText },
        bubbleTextAssistant: { color: t.text },
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
        artifactTitle: { color: t.textMuted, fontSize: 11, fontWeight: "600" },
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

  /** 单条消息气泡 */
  const renderMessage = (item: ChatMessage) => {
    const isUser = item.role === "user"
    // 思考过程 / 工具详情：点击标题行展开（外层轨迹条默认收拢）
    const traceKey = `trace-${item.id}`
    const traceOpen = expanded.has(traceKey)
    if (item.role === "tool") {
      return (
        <Pressable key={item.id} style={styles.traceBlock} onPress={() => toggleTrace(traceKey)}>
          <View style={styles.traceHead}>
            {traceOpen ? <ChevronDown size={12} color={t.textMuted} /> : <ChevronRight size={12} color={t.textMuted} />}
            <Text style={styles.traceTitle}>工具调用 · {item.toolName ?? "tool"}{item.isError ? "（失败）" : ""}</Text>
          </View>
          {traceOpen && item.content ? <Text style={styles.traceText}>{String(item.content)}</Text> : null}
        </Pressable>
      )
    }
    // 助手消息：思考过程（收拢）+ 正文（Markdown）
    return (
      <View key={item.id} style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          {item.thinking ? (
            <Pressable style={styles.thinkingBlock} onPress={() => toggleTrace(traceKey)}>
              <View style={styles.traceHead}>
                {traceOpen ? <ChevronDown size={12} color={t.textMuted} /> : <ChevronRight size={12} color={t.textMuted} />}
                <Text style={styles.thinkingTitle}>思考过程</Text>
              </View>
              {traceOpen ? <Text style={styles.thinkingText}>{String(item.thinking)}</Text> : null}
            </Pressable>
          ) : null}
          {isUser ? (
            <View>
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
              {item.content ? (
                <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{String(item.content)}</Text>
              ) : null}
            </View>
          ) : (
            assistantBody(String(item.content ?? ""))
          )}
        </View>
      </View>
    )
  }

  /**
   * 任务组：用户消息 → 轨迹摘要条（收拢思考/工具）→ 最终回答常显
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

    return (
      <View style={styles.group}>
        {group.user ? renderMessage(group.user) : null}
        {toolCount === 0 ? (
          items.map(renderMessage)
        ) : (
          <>
            <RunTrace meta={meta} running={running} toolCount={toolCount} colors={t}>
              {items.filter((_, i) => i !== finalIdx).map(renderMessage)}
            </RunTrace>
            {finalIdx >= 0 ? renderMessage(items[finalIdx]) : null}
          </>
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
            <ActivityIndicator color={t.accent} />
          </View>
        }
        renderItem={renderGroup}
        ListFooterComponent={
          !messagesLoading && artifacts.length > 0 ? (
            <View style={styles.artifactWrap}>
              <Text style={styles.artifactTitle}>生成的产物</Text>
              {artifacts.map((a) => (
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
          ) : undefined
        }
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
