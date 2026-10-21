/**
 * 资料库 - 笔记 tab
 * 横向分类筛选条 + 按分类分组的响应式卡片网格（窄屏 1 列 / 中屏 2 列 / 宽屏 3 列）
 */
import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { StickyNote, Plus, Folder } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@renderer/components/ui/dialog"
import { cn, timeAgo } from "@renderer/lib/utils"

interface NoteItem {
  id: string
  title: string
  content: string
  status: "draft" | "submitted"
  category: string
  tags: string[]
  updated_at: number
}

interface NoteCategory {
  id: string
  name: string
  icon: string
  note_count: number
}

interface NoteListResponse {
  notes: NoteItem[]
  total: number
}

export function LibraryNotesTab({
  search,
  refreshKey,
  onOpenNote,
  onCreateNote,
}: {
  search: string
  refreshKey?: number
  onOpenNote: (id: string) => void
  onCreateNote: () => void
}) {
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [categories, setCategories] = useState<NoteCategory[]>([])
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadCategories = useCallback(async () => {
    const res = (await window.nexa.noteCategories()) as NoteCategory[]
    setCategories(res)
  }, [])

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const res = (await window.nexa.noteList({})) as NoteListResponse
      setNotes(res.notes ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCategories()
    void loadNotes()
  }, [loadCategories, loadNotes, refreshKey])

  // 新增分类对话框状态（window.prompt 在 Electron 被禁用，改用 shadcn Dialog + Input）
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [catInputName, setCatInputName] = useState("")
  const [catError, setCatError] = useState<string | null>(null)
  const [catBusy, setCatBusy] = useState(false)
  const catInputRef = useRef<HTMLInputElement>(null)

  const openCatDialog = () => {
    setCatInputName("")
    setCatError(null)
    setCatDialogOpen(true)
    // Dialog open 后聚焦输入框
    setTimeout(() => catInputRef.current?.focus(), 0)
  }

  const submitCategory = async () => {
    const name = catInputName.trim()
    if (!name) {
      setCatError("请输入分类名称")
      return
    }
    setCatBusy(true)
    setCatError(null)
    try {
      await window.nexa.noteAddCategory({ name })
      setCatDialogOpen(false)
      void loadCategories()
    } catch (err) {
      setCatError(err instanceof Error ? err.message : String(err))
    } finally {
      setCatBusy(false)
    }
  }

  // 按分类分组
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = notes.filter((n) => {
      if (filterCategory && n.category !== filterCategory) return false
      if (q && !n.title.toLowerCase().includes(q) && !n.content.toLowerCase().includes(q)) return false
      return true
    })
    const map = new Map<string, NoteItem[]>()
    for (const n of filtered) {
      const arr = map.get(n.category) ?? []
      arr.push(n)
      map.set(n.category, arr)
    }
    return map
  }, [notes, filterCategory, search])

  // 分类列表（含未分类兜底）
  const displayCategories = useMemo(() => {
    const cats = categories.length > 0 ? categories : [{ id: "c0", name: "未分类", icon: "📁", note_count: 0 }]
    return [{ id: "all", name: "全部笔记", icon: "📝", note_count: notes.length }, ...cats]
  }, [categories, notes.length])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div className="flex h-full flex-col">
      {/* 横向分类筛选条 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
        {displayCategories.map((cat) => {
          const active = (cat.id === "all" && !filterCategory) || filterCategory === cat.name
          return (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id === "all" ? null : cat.name)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span>{cat.icon}</span> {cat.name}
              <span className={active ? "text-primary/70" : "text-muted-foreground/60"}>{cat.note_count}</span>
            </button>
          )
        })}
        <button
          onClick={openCatDialog}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3 w-3" /> 新增分类
        </button>
        <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5 text-xs" onClick={onCreateNote}>
          <Plus className="h-3.5 w-3.5" /> 新增笔记
        </Button>
      </div>

      {/* 新增分类对话框（替代被 Electron 禁用的 window.prompt） */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新增笔记分类</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              ref={catInputRef}
              value={catInputName}
              onChange={(e) => setCatInputName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !catBusy) {
                  e.preventDefault()
                  void submitCategory()
                }
              }}
              placeholder="例如：会议、灵感、读书笔记…"
              className="h-9"
              disabled={catBusy}
            />
            {catError && (
              <p className="text-xs text-destructive">{catError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatDialogOpen(false)}
              disabled={catBusy}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void submitCategory()}
              disabled={catBusy || !catInputName.trim()}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 按分类分组的笔记卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <StickyNote className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有笔记</p>
            <p className="text-xs text-muted-foreground/70">点「新增笔记」开始记录</p>
          </div>
        ) : grouped.size === 0 ? (
          /* 有笔记但当前筛选/搜索无结果（如切到一个空分类） */
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <StickyNote className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {search.trim() ? "没有匹配的笔记" : `「${filterCategory ?? ""}」下暂无笔记`}
            </p>
            <p className="text-xs text-muted-foreground/70">
              {search.trim() ? "试试换个关键词，或切换到其他分类" : "点「新增笔记」在这个分类下新建一条"}
            </p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="mb-5">
              <div className="mb-2 flex items-center gap-2 px-1">
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{category}</span>
                <span className="text-[10px] text-muted-foreground">{items.length}</span>
                {items.some((n) => n.status === "draft") && (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-600 dark:text-amber-400">含草稿</span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {items.map((note) => (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenNote(note.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onOpenNote(note.id)
                      }
                    }}
                    className="group cursor-pointer rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      {note.status === "draft" ? (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">草稿</span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已提交</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{timeAgo(note.updated_at)}</span>
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{note.category}</span>
                    </div>
                    <div className="line-clamp-2 text-sm font-semibold leading-snug">{note.title || "(无标题)"}</div>
                    {note.content && (
                      <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {note.content.replace(/[#*>`]/g, "").trim().slice(0, 120)}
                      </div>
                    )}
                    {note.tags.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {note.tags.slice(0, 5).map((t) => (
                          <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
