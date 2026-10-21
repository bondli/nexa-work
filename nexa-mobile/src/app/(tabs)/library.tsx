/**
 * 资料库页：对齐桌面端 —— 文件（文章/文档/图片/金句）+ 纯笔记，点击查看详情
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Link, useFocusEffect } from "expo-router"
import { FileText, Image as ImageIcon, Quote } from "lucide-react-native"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"
import { fmtTsShort } from "@/lib/time"
import type { LibraryItemSummary } from "@/lib/relay/protocol"

type Seg = "files" | "notes"

const TYPE_ICON = { article: FileText, image: ImageIcon, doc: FileText, note: Quote } as const
/** 类型中文标签（对齐桌面端资料库：金句=kb type note） */
const TYPE_LABEL: Record<string, string> = { article: "文章", doc: "文档", image: "图片", note: "金句" }

export default function LibraryScreen() {
  const { colors: t } = useTheme()
  const status = useRelayStore((s) => s.status)
  const libraryItems = useRelayStore((s) => s.libraryItems)
  const notes = useRelayStore((s) => s.notes)
  const loadingLibrary = useRelayStore((s) => s.loadingLibrary)
  const libraryError = useRelayStore((s) => s.libraryError)
  const loadLibrary = useRelayStore((s) => s.loadLibrary)
  const [seg, setSeg] = useState<Seg>("files")
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (status.peerOnline) void loadLibrary()
  }, [status.peerOnline, loadLibrary])

  useFocusEffect(
    useCallback(() => {
      if (status.peerOnline) void loadLibrary()
    }, [status.peerOnline, loadLibrary])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadLibrary()
    setRefreshing(false)
  }, [loadLibrary])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        segRow: {
          flexDirection: "row",
          paddingHorizontal: 12,
          paddingTop: 6,
          paddingBottom: 2,
          gap: 8,
        },
        segBtn: {
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: 16,
          backgroundColor: t.card,
        },
        segBtnActive: { backgroundColor: t.accentSoft },
        segText: { color: t.textMuted, fontSize: 13 },
        segTextActive: { color: t.accent, fontWeight: "600" },
        listContent: { padding: 12, paddingBottom: 24, gap: 8 },
        empty: { padding: 48, alignItems: "center" },
        emptyText: { color: t.textMuted, fontSize: 14 },
        sep: { height: 0 },
        item: { flexDirection: "row", gap: 12, backgroundColor: t.card, borderRadius: 12, padding: 12 },
        iconWrap: { width: 36, height: 36, borderRadius: 8, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" },
        itemBody: { flex: 1, gap: 3 },
        itemTitle: { color: t.text, fontSize: 15, fontWeight: "500" },
        itemSummary: { color: t.textSecondary, fontSize: 13, lineHeight: 18 },
        itemMeta: { color: t.textMuted, fontSize: 11 },
      }),
    [t]
  )

  const data: LibraryItemSummary[] = seg === "files" ? libraryItems : notes

  const renderItem = ({ item }: { item: LibraryItemSummary }) => {
    // 笔记 tab 下全是 note 表纯笔记：徽章固定「笔记」，不用 kb 的「金句」语义（kb type=note 才是金句）
    const isNoteRow = seg === "notes"
    const Icon = isNoteRow ? FileText : (TYPE_ICON[item.type as keyof typeof TYPE_ICON] ?? FileText)
    const typeLabel = isNoteRow ? "笔记" : (TYPE_LABEL[item.type] ?? item.type)
    // note 表条目（source_url 以 note: 开头）与知识库条目都用 id 打开详情页，详情页内自行分派
    // 注意：href 必须内联模板字符串，以满足 expo-router typed routes 的字面量类型检查
    const idPart = String(item.source_url ?? "").startsWith("note:") ? String(item.source_url) : item.id
    return (
      <Link href={`/library/${encodeURIComponent(idPart)}`} asChild>
        <Pressable style={styles.item}>
          <View style={styles.iconWrap}>
            <Icon size={18} color={t.accent} />
          </View>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle} numberOfLines={1}>{item.title || "无标题"}</Text>
            {item.summary ? <Text style={styles.itemSummary} numberOfLines={2}>{String(item.summary)}</Text> : null}
            <Text style={styles.itemMeta}>
              {typeLabel} {fmtTsShort(item.updated_at ?? item.created_at) ? `· ${fmtTsShort(item.updated_at ?? item.created_at)}` : ""}
            </Text>
          </View>
        </Pressable>
      </Link>
    )
  }

  return (
    <View style={styles.container}>
      {/* 分段切换：文件 / 笔记 */}
      <View style={styles.segRow}>
        {(["files", "notes"] as Seg[]).map((s) => (
          <Pressable key={s} style={[styles.segBtn, seg === s && styles.segBtnActive]} onPress={() => setSeg(s)}>
            <Text style={[styles.segText, seg === s && styles.segTextActive]}>{s === "files" ? "文件" : "笔记"}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={data}
        keyExtractor={(item, idx) => item.id || `lib-${idx}`}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loadingLibrary ? (
              <ActivityIndicator color={t.accent} />
            ) : (
              <Text style={styles.emptyText}>
                {libraryError
                  ? libraryError
                  : status.peerOnline
                    ? seg === "files"
                      ? "资料库为空"
                      : "还没有笔记"
                    : "电脑离线，无法获取资料"}
              </Text>
            )}
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={renderItem}
      />
    </View>
  )
}
