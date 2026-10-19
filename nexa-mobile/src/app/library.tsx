/**
 * 手机端资料库页面 — 轻量搜索 + 结果列表
 * 产品文档 §3.6: 资料库：轻量浏览，支持收藏和简单搜索
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useRelayStore } from "@/lib/relay/service"
import type { LibrarySearchResult } from "@/lib/relay/protocol"

const TYPE_LABEL: Record<string, string> = {
  article: "文章",
  doc: "文档",
  image: "图片",
  note: "笔记",
}

export default function LibraryScreen() {
  const status = useRelayStore((s) => s.status)
  const searchLibrary = useRelayStore((s) => s.searchLibrary)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<LibrarySearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const online = status.peerOnline

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !online) return
      setLoading(true)
      setSearched(true)
      try {
        const r = await searchLibrary(q.trim())
        setResults(r)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [searchLibrary, online],
  )

  // 防抖搜索
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const q = query.trim()
    if (!q) { setResults([]); setSearched(false); return }
    timerRef.current = setTimeout(() => void doSearch(q), 400)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query, doSearch])

  return (
    <View style={styles.container}>
      {/* 搜索框 */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索资料库…"
          placeholderTextColor="#737373"
          returnKeyType="search"
          onSubmitEditing={() => { Keyboard.dismiss(); void doSearch(query) }}
        />
        {loading && <ActivityIndicator style={styles.spinner} color="#3b82f6" size="small" />}
      </View>

      {/* 离线提示 */}
      {!online && (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>电脑离线，无法搜索资料库</Text>
        </View>
      )}

      {/* 结果列表 */}
      {online && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            searched && !loading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>无匹配结果</Text>
              </View>
            ) : !searched ? (
              <View style={styles.empty}>
                <Text style={styles.emptyHint}>输入关键词搜索桌面端资料库</Text>
                <Text style={styles.emptySub}>文章 · 文档 · 图片 · 笔记</Text>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <View style={styles.resultItem}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultType}>
                  {TYPE_LABEL[item.type] ?? item.type}
                </Text>
              </View>
              <Text style={styles.resultTitle} numberOfLines={2}>
                {item.title || "未命名"}
              </Text>
              {item.summary ? (
                <Text style={styles.resultSummary} numberOfLines={3}>
                  {item.summary}
                </Text>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#262626",
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#171717",
    color: "#fafafa",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  spinner: { marginLeft: 10 },
  offline: { padding: 40, alignItems: "center" },
  offlineText: { color: "#737373", fontSize: 14 },
  empty: { padding: 40, alignItems: "center" },
  emptyText: { color: "#737373", fontSize: 14 },
  emptyHint: { color: "#a3a3a3", fontSize: 15, fontWeight: "500" },
  emptySub: { color: "#525252", fontSize: 12, marginTop: 6 },
  sep: { height: 1, backgroundColor: "#171717" },
  resultItem: { paddingHorizontal: 16, paddingVertical: 14 },
  resultHeader: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  resultType: {
    color: "#3b82f6",
    fontSize: 11,
    fontWeight: "600",
    backgroundColor: "#3b82f615",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
  },
  resultTitle: { color: "#fafafa", fontSize: 15, fontWeight: "500", lineHeight: 21 },
  resultSummary: { color: "#a3a3a3", fontSize: 13, marginTop: 4, lineHeight: 18 },
})
