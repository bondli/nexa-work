/**
 * 资料详情：知识库条目（正文读自桌面文件）或笔记全文
 * 图片条目直接渲染原图；md/markdown 用 Markdown 预览器；html/htm 用 WebView 渲染
 */
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import Markdown from "react-native-markdown-display"
import { WebView } from "react-native-webview"
import { useTheme, type ThemeColors } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"
import { ImageViewer } from "@/components/image-viewer"
import type { LibraryItemSummary } from "@/lib/relay/protocol"

/** 路由级错误边界：渲染异常时显示错误信息便于排查 */
export function ErrorBoundary({ error }: { error: Error }) {
  const { colors: t } = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: t.danger, fontSize: 16, fontWeight: "600", marginBottom: 8 }}>页面出错了</Text>
      <Text style={{ color: t.textMuted, fontSize: 12, textAlign: "center" }}>{String(error?.message ?? error)}</Text>
    </View>
  )
}

/** 判断正文是否为 HTML 文档（kb 文档条目正文是完整 html/md 文件内容） */
function looksLikeHtml(content: string): boolean {
  const head = content.slice(0, 300).toLowerCase()
  return head.includes("<!doctype html") || head.includes("<html")
}

/** Markdown 配色（与任务详情页一致，随主题重建） */
function makeMdStyles(t: ThemeColors) {
  return {
    body: { color: t.textSecondary, fontSize: 15, lineHeight: 24 },
    strong: { color: t.text, fontWeight: "700" },
    em: { color: t.textSecondary },
    heading1: { color: t.text, fontSize: 20, fontWeight: "700", marginTop: 10, marginBottom: 6 },
    heading2: { color: t.text, fontSize: 18, fontWeight: "700", marginTop: 10, marginBottom: 5 },
    heading3: { color: t.text, fontSize: 16, fontWeight: "600", marginTop: 8, marginBottom: 4 },
    link: { color: t.accent },
    bullet_list: { marginTop: 4, marginBottom: 4 },
    ordered_list: { marginTop: 4, marginBottom: 4 },
    list_item: { marginBottom: 2 },
    code_inline: {
      color: "#fbbf24",
      backgroundColor: "rgba(251,191,36,0.10)",
      fontFamily: "Menlo",
      fontSize: 13,
    },
    fence: {
      backgroundColor: t.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      color: t.textSecondary,
      fontFamily: "Menlo",
      fontSize: 12.5,
    },
    blockquote: { backgroundColor: t.accentSoft, borderLeftColor: t.accent, borderLeftWidth: 3 },
    hr: { backgroundColor: t.border },
  } as const
}

export default function LibraryDetailScreen() {
  const { colors: t } = useTheme()
  const params = useLocalSearchParams()
  // id 可能是 "note:<noteId>"（note 表条目）或知识库条目 id
  const rawId = decodeURIComponent(String(params.id ?? ""))
  const isNoteRow = rawId.startsWith("note:")
  const loadLibraryItem = useRelayStore((s) => s.loadLibraryItem)

  const [item, setItem] = useState<LibraryItemSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 图片宽高比：RN Image 必须显式尺寸，先 getSize 再按屏幕宽等比渲染
  const [imgRatio, setImgRatio] = useState(1)
  // 全屏图片查看（点击图片打开，支持缩放拖动）
  const [viewerOpen, setViewerOpen] = useState(false)

  // 样式随主题重建（亮/暗切换时自动生效）；须放在提前 return 之前保证 hooks 顺序稳定
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        content: { padding: 16, paddingBottom: 40, gap: 10 },
        center: { flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" },
        errorText: { color: t.textMuted, fontSize: 14, textAlign: "center", padding: 24 },
        title: { color: t.text, fontSize: 20, fontWeight: "700", lineHeight: 28 },
        meta: { color: t.accent, fontSize: 12 },
        summary: { color: t.textSecondary, fontSize: 14, lineHeight: 21 },
        bodyText: { color: t.textSecondary, fontSize: 15, lineHeight: 24 },
        hint: { color: t.textMuted, fontSize: 13 },
        // 图片/WebView 容器
        image: { width: "100%", borderRadius: 12, backgroundColor: t.card },
        webviewWrap: { flex: 1, backgroundColor: t.bg },
        webview: { flex: 1, backgroundColor: "transparent" },
      }),
    [t]
  )
  const mdStyles = useMemo(() => makeMdStyles(t), [t])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const it = await loadLibraryItem(rawId)
        if (active) setItem(it)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [rawId, loadLibraryItem])

  useEffect(() => {
    const uri = item?.dataUrl ? String(item.dataUrl) : null
    if (!uri) return
    Image.getSize(uri, (w, h) => setImgRatio(h > 0 ? w / h : 1), () => {})
  }, [item?.dataUrl])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.accent} />
      </View>
    )
  }

  if (error || !item) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? "条目不存在或已被删除"}</Text>
      </View>
    )
  }

  const content = item.content != null ? String(item.content) : null

  // HTML 文档：整页 WebView 渲染（标题已在导航栏，不再重复展示 meta）
  if (content && looksLikeHtml(content)) {
    return (
      <View style={styles.webviewWrap}>
        <WebView
          style={styles.webview}
          source={{ html: content }}
          originWhitelist={["*"]}
          // 手机端预览只做只读渲染，禁用 JS 弹窗/文件访问
          javaScriptEnabled
          domStorageEnabled
          scalesPageToFit
        />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{item.title || "无标题"}</Text>
      <Text style={styles.meta}>
        {item.type}
        {item.source_url && !isNoteRow ? ` · ${String(item.source_url)}` : ""}
      </Text>
      {item.summary ? <Text style={styles.summary}>{String(item.summary)}</Text> : null}
      {item.type === "image" ? (
        item.dataUrl ? (
          // 图片条目：原图 dataURL 直接渲染，按屏幕宽度等比缩放；点击进入全屏可缩放查看
          <>
            <Pressable
              onPress={() => setViewerOpen(true)}
              android_ripple={{ color: "transparent" }}
              accessibilityLabel="查看大图"
            >
              <Image source={{ uri: String(item.dataUrl) }} style={[styles.image, { aspectRatio: imgRatio }]} resizeMode="contain" />
            </Pressable>
            <ImageViewer
              uri={String(item.dataUrl)}
              visible={viewerOpen}
              onClose={() => setViewerOpen(false)}
            />
          </>
        ) : (
          <Text style={styles.hint}>图片读取失败或已不存在</Text>
        )
      ) : content ? (
        // md / 金句 / 文章正文：Markdown 预览器渲染
        <Markdown style={mdStyles}>{content}</Markdown>
      ) : (
        <Text style={styles.hint}>暂无正文内容</Text>
      )}
    </ScrollView>
  )
}
