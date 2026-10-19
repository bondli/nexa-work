/**
 * 笔记编辑器 —— 全页 markdown 编辑
 * 标题 / 分类选择 / 标签 / 内容编辑 / 保存草稿 / 提交 / 删除 / 返回
 */
import { useEffect, useState, useCallback, useRef } from "react"
import { ArrowLeft, Save, Check, Trash2 } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@renderer/components/ui/dialog"
import { cn } from "@renderer/lib/utils"

interface NoteData {
  id: string
  title: string
  content: string
  status: "draft" | "submitted"
  category: string
  tags: string[]
}

interface NoteCategory {
  id: string
  name: string
  icon: string
}

export function NoteEditor({
  noteId,
  onClose,
}: {
  noteId?: string
  onClose: () => void
}) {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [status, setStatus] = useState<"draft" | "submitted">("draft")
  const [category, setCategory] = useState("未分类")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [categories, setCategories] = useState<NoteCategory[]>([])
  const [saving, setSaving] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(noteId ?? null)
  const [showPreview, setShowPreview] = useState(false)
  /** 删除确认弹框（Electron 不支持 window.confirm，改用 shadcn Dialog） */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载分类
  useEffect(() => {
    void window.nexa.noteCategories().then((res: unknown) => {
      setCategories(res as NoteCategory[])
    })
  }, [])

  // 加载已有笔记
  const loadNote = useCallback(async () => {
    if (!noteId) return
    const res = (await window.nexa.noteGet(noteId)) as NoteData
    if (res) {
      setTitle(res.title)
      setContent(res.content)
      setStatus(res.status)
      setCategory(res.category)
      setTags(res.tags)
      setCurrentId(res.id)
    }
  }, [noteId])

  useEffect(() => { void loadNote() }, [loadNote])

  // 自动保存草稿（30s）
  useEffect(() => {
    if (!title.trim() && !content.trim()) return
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(() => {
      void doSave(false)
    }, 30_000)
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, category, tags])

  const doSave = async (close: boolean) => {
    if (!title.trim()) return
    setSaving(true)
    try {
      if (currentId) {
        await window.nexa.noteUpdate(currentId, { title, content, status, category, tags })
      } else {
        const res = (await window.nexa.noteCreate({ title, content, status, category, tags })) as { id: string }
        setCurrentId(res.id)
      }
      if (close) onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!title.trim()) return
    setStatus("submitted")
    setSaving(true)
    try {
      if (currentId) {
        await window.nexa.noteUpdate(currentId, { title, content, status: "submitted", category, tags })
      } else {
        await window.nexa.noteCreate({ title, content, status: "submitted", category, tags })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    // 尚未落库的草稿无需确认，直接返回
    if (!currentId) {
      onClose()
      return
    }
    setConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!currentId) return
    setDeleting(true)
    try {
      await window.nexa.noteDelete(currentId)
      setConfirmOpen(false)
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  const handleTagAdd = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
    }
    setTagInput("")
  }

  const handleTagRemove = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部: 返回 + 标题 + 状态 + 操作 */}
      <div className="flex items-center gap-3 border-b border-border bg-background px-6 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回
        </button>
        <div className="flex items-center gap-2">
          {status === "draft" ? (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">草稿</span>
          ) : (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">已提交</span>
          )}
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => void doSave(false)} disabled={saving || !title.trim()}>
          <Save className="h-3.5 w-3.5" /> 保存草稿
        </Button>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => void handleSubmit()} disabled={saving || !title.trim()}>
          <Check className="h-3.5 w-3.5" /> 提交
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="删除笔记"
          title="删除笔记"
          disabled={deleting}
          className="h-7 w-7 text-muted-foreground hover:text-red-500"
          onClick={handleDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* 分类 + 标签行 */}
        <div className="mb-4 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">分类</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.name}>{cat.name}</option>
              ))}
              <option value="未分类">未分类</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">标签</span>
            <div className="flex flex-wrap items-center gap-1">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  #{t}
                  <button onClick={() => handleTagRemove(t)} className="text-muted-foreground hover:text-red-500">×</button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleTagAdd() } }}
                placeholder="添加标签…"
                className="w-20 rounded border border-input bg-background px-1.5 py-0.5 text-[11px] outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* 标题 */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入笔记标题..."
          className="mb-4 w-full border-none bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground"
        />

        {/* 工具栏: 编辑/预览切换 */}
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => setShowPreview(false)}
            className={cn("rounded-md px-2 py-1 text-xs", !showPreview ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}
          >
            编辑
          </button>
          <button
            onClick={() => setShowPreview(true)}
            className={cn("rounded-md px-2 py-1 text-xs", showPreview ? "bg-muted font-medium text-foreground" : "text-muted-foreground")}
          >
            预览
          </button>
        </div>

        {/* 编辑/预览 */}
        {showPreview ? (
          <div className="note-preview max-w-none rounded-xl border border-border bg-background p-6">
            <MarkdownPreview content={content} />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="## 在此输入 Markdown 内容..."
            className="h-[60vh] w-full resize-none rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </div>

      {/* 删除确认弹框 */}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!deleting) setConfirmOpen(open) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除这条笔记？</DialogTitle>
            <DialogDescription>
              {title.trim() ? `「${title.trim()}」删除后不可恢复。` : "删除后不可恢复。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 轻量 Markdown 预览（不引入额外依赖，支持标题/粗体/列表/代码块） */
function MarkdownPreview({ content }: { content: string }) {
  const html = renderMarkdown(content)
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function renderMarkdown(md: string): string {
  // 转义 HTML
  let s = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  // 代码块
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
  // 标题
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>")
  s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>")
  s = s.replace(/^# (.+)$/gm, "<h1>$1</h1>")
  // 粗体
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // 斜体
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>")
  // 行内代码
  s = s.replace(/`(.+?)`/g, "<code>$1</code>")
  // 无序列表
  s = s.replace(/^- (.+)$/gm, "<li>$1</li>")
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
  // 引用
  s = s.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
  // 段落（连续非空行）
  s = s.replace(/^(?!<[hupobl])(.+)$/gm, "<p>$1</p>")
  return s
}
