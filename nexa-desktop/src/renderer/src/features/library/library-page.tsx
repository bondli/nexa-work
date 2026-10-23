/**
 * 资料库页面 —— 单列结构: 标题行（右侧搜索框 + 文件/笔记 tab 组） + 全宽内容
 */
import { useState, useCallback } from "react"
import { Search, FileText, StickyNote, RefreshCw } from "lucide-react"
import { PageTitleBar } from "@renderer/components/page-layout"
import { cn } from "@renderer/lib/utils"
import { LibraryFilesTab } from "./library-files-tab"
import { LibraryNotesTab } from "./library-notes-tab"
import { NoteEditor } from "./note-editor"

type LibraryTab = "files" | "notes"

const LIB_TABS: { id: LibraryTab; label: string; icon: typeof FileText }[] = [
  { id: "files", label: "文件", icon: FileText },
  { id: "notes", label: "笔记", icon: StickyNote },
]

export function LibraryPage() {
  const [tab, setTab] = useState<LibraryTab>("files")
  const [search, setSearch] = useState("")
  /** 编辑中的笔记 ID；null = 列表视图 */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  /** 是否新建笔记 */
  const [isNewNote, setIsNewNote] = useState(false)
  /** 新建笔记时从列表透传过来的默认分类（用户在 tab 里点了某个分类 → 进编辑器就默认选那个） */
  const [newNoteCategory, setNewNoteCategory] = useState<string | null>(null)
  /** 手动刷新计数，点击刷新按钮 +1 触发子 tab 重新拉数据 */
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setRefreshKey((k) => k + 1)
    // 给子 tab 一点时间重新加载后清除 loading 态
    setTimeout(() => setRefreshing(false), 600)
  }, [])

  // 笔记编辑器视图: 保留标题行（拖动 + 页面标题），编辑器占满下方区域
  if (editingNoteId !== null) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <PageTitleBar title="资料库" />
        <NoteEditor
          noteId={isNewNote ? undefined : editingNoteId}
          defaultCategory={isNewNote ? newNoteCategory : null}
          onClose={() => { setEditingNoteId(null); setIsNewNote(false); setNewNoteCategory(null) }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageTitleBar
        title="资料库"
        actions={
          /* 刷新按钮 + 搜索框 + 分区 tab 组（文件 / 笔记） */
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="刷新资料库"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索资料库..."
                className="h-7 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              {LIB_TABS.map((t) => {
                const Icon = t.icon
                const active = tab === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        }
      />

      <div className="min-h-0 flex-1">
        {tab === "files" ? (
          <LibraryFilesTab search={search} refreshKey={refreshKey} />
        ) : (
          <LibraryNotesTab
            search={search}
            refreshKey={refreshKey}
            onOpenNote={(id) => { setIsNewNote(false); setNewNoteCategory(null); setEditingNoteId(id) }}
            onCreateNote={(cat) => { setIsNewNote(true); setNewNoteCategory(cat); setEditingNoteId("new") }}
          />
        )}
      </div>
    </div>
  )
}
