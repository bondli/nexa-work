/**
 * 笔记管理页 - 对齐桌面端资料库笔记 tab 的核心能力
 * 左：分类筛选 + 搜索 + 笔记列表
 * 右：标题 / 分类 / 内容编辑 + 保存 / 删除 / 新建
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Loader2, Plus, Search, Trash2, X } from "lucide-react"
import type { NoteCategoryWithCount, NoteListResponse, NoteRow } from "../shared/notes"
import "../styles/tailwind.css"

// ===== RPC 调用 =====

type RpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function rpc<T>(method: string, payload?: unknown): Promise<RpcResult<T>> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: "rpc",
      method,
      payload,
    })) as { ok: boolean; data?: T; error?: string }
    if (!res) return { ok: false, error: "无响应" }
    if (res.ok) return { ok: true, data: res.data as T }
    return { ok: false, error: res.error || "调用失败" }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ===== 工具 =====

function formatTime(sec: number): string {
  const d = new Date(sec * 1000)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return "刚刚"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ===== 主组件 =====

function NotesPage() {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [categories, setCategories] = useState<NoteCategoryWithCount[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState<{ title: string; content: string; category: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [notesRes, catsRes] = await Promise.all([
      rpc<NoteListResponse>("note.list", selectedCategory || search ? { category: selectedCategory ?? undefined, search: search || undefined } : undefined),
      rpc<NoteCategoryWithCount[]>("note.categories"),
    ])
    if (notesRes.ok) setNotes(notesRes.data.notes)
    else setError(notesRes.error)
    if (catsRes.ok) setCategories(catsRes.data)
    setLoading(false)
  }, [selectedCategory, search])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId) {
      setDraft(null)
      return
    }
    let cancelled = false
    void rpc<NoteRow>("note.get", { id: selectedId }).then((res) => {
      if (cancelled) return
      if (res.ok && res.data) {
        setDraft({
          title: res.data.title,
          content: res.data.content,
          category: res.data.category,
        })
        dirtyRef.current = false
      }
    })
    return () => { cancelled = true }
  }, [selectedId])

  const scheduleSave = useCallback(() => {
    if (!selectedId || !draft) return
    dirtyRef.current = true
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!dirtyRef.current || !selectedId) return
      setSaving(true)
      const res = await rpc("note.update", {
        id: selectedId,
        patch: { title: draft.title, content: draft.content, category: draft.category },
      })
      setSaving(false)
      if (res.ok) {
        dirtyRef.current = false
        setSavedAt(Date.now())
        setNotes((prev) => prev.map((n) => (n.id === selectedId ? { ...n, title: draft.title, category: draft.category } : n)))
      }
    }, 1000)
  }, [selectedId, draft])

  useEffect(() => {
    if (draft) scheduleSave()
  }, [draft, scheduleSave])

  const handleCreate = async () => {
    const res = await rpc<NoteRow>("note.create", { title: "未命名笔记", content: "", category: selectedCategory })
    if (res.ok) {
      await refresh()
      setSelectedId(res.data.id)
    } else {
      alert(`新建失败：${res.error}`)
    }
  }

  const handleDelete = async () => {
    if (!selectedId) return
    if (!confirm("确定删除这条笔记？删除后不可恢复。")) return
    const res = await rpc("note.delete", { id: selectedId })
    if (res.ok) {
      setSelectedId(null)
      setDraft(null)
      await refresh()
    } else {
      alert(`删除失败：${res.error}`)
    }
  }

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedId), [notes, selectedId])

  return (
    <div className="h-screen flex flex-col bg-white text-neutral-900">
      {/* 顶栏 */}
      <div className="h-12 border-b border-neutral-200 flex items-center px-4 gap-3 shrink-0">
        <button
          onClick={() => window.close()}
          className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900 transition-colors"
          title="关闭"
        >
          <X size={16} />
        </button>
        <div className="text-sm font-semibold">Nexa 笔记</div>
        <div className="ml-auto flex items-center gap-2">
          {saving && (
            <span className="text-[11px] text-neutral-500 flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" />
              保存中
            </span>
          )}
          {!saving && savedAt && (
            <span className="text-[11px] text-neutral-500">已保存</span>
          )}
          <button
            onClick={handleCreate}
            className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <Plus size={12} />
            新建笔记
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* 左侧栏 */}
        <div className="w-[280px] border-r border-neutral-200 flex flex-col shrink-0 bg-neutral-50">
          {/* 搜索 */}
          <div className="p-3 border-b border-neutral-200">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索笔记..."
                className="w-full bg-white border border-neutral-300 rounded-md pl-8 pr-2 py-1.5 text-xs placeholder:text-neutral-400 focus:outline-none focus:border-red-500"
              />
            </div>
          </div>

          {/* 分类 */}
          <div className="px-3 py-2 border-b border-neutral-200 flex flex-wrap gap-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                selectedCategory === null
                  ? "bg-red-50 text-red-600 border border-red-200"
                  : "bg-white text-neutral-600 border border-neutral-300 hover:text-neutral-900"
              }`}
            >
              全部
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.name === selectedCategory ? null : c.name)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  selectedCategory === c.name
                    ? "bg-red-50 text-red-600 border border-red-200"
                    : "bg-white text-neutral-600 border border-neutral-300 hover:text-neutral-900"
                }`}
              >
                {c.name} ({c.note_count ?? 0})
              </button>
            ))}
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto bg-white">
            {loading ? (
              <div className="p-6 text-center text-xs text-neutral-400">
                <Loader2 size={16} className="animate-spin inline-block" />
              </div>
            ) : error ? (
              <div className="p-4 text-xs text-red-600">{error}</div>
            ) : notes.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-400">暂无笔记</div>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-neutral-100 hover:bg-neutral-50 transition-colors ${
                    selectedId === n.id ? "bg-red-50/60 border-l-2 border-l-red-600" : ""
                  }`}
                >
                  <div className="text-[13px] font-medium truncate text-neutral-900">{n.title || "未命名"}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5 flex items-center gap-2">
                    {n.category && <span className="text-red-600/80">{n.category}</span>}
                    <span className="ml-auto shrink-0">{formatTime(n.updated_at)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右侧编辑器 */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedNote || !draft ? (
            <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
              {notes.length === 0 ? "点击右上角「新建笔记」开始" : "从左侧选择一条笔记"}
            </div>
          ) : (
            <>
              {/* 标题栏 */}
              <div className="p-4 border-b border-neutral-200 flex items-center gap-3">
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="笔记标题"
                  className="flex-1 bg-transparent text-lg font-semibold placeholder:text-neutral-300 focus:outline-none"
                />
                <select
                  value={draft.category ?? ""}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value || null })}
                  className="bg-white border border-neutral-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:border-red-500"
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleDelete}
                  className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-400 hover:text-red-600 transition-colors"
                  title="删除笔记"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* 内容编辑 */}
              <textarea
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder="开始记录..."
                className="flex-1 bg-transparent p-4 text-sm leading-relaxed placeholder:text-neutral-300 focus:outline-none resize-none"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(<NotesPage />)
