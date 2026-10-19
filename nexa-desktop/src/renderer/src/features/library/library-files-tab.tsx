/**
 * 资料库 - 文件 tab
 * 横向类型筛选条 + 响应式卡片网格（窄屏 1 列 / 中屏 2 列 / 宽屏 3 列）
 * 卡片文案限 2 行，点击卡片打开详情弹框查看全文；删除走确认弹框
 */
import { useEffect, useMemo, useState, useCallback } from "react"
import { FileText, Newspaper, Image, FileType, Trash2, ExternalLink, X } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@renderer/components/ui/dialog"
import { cn, timeAgo } from "@renderer/lib/utils"

interface KbItem {
  id: string
  type: "note" | "article" | "image" | "doc"
  title: string
  summary: string
  keywords: string[]
  tags: string[]
  source_url: string | null
  created_at: number
}

const TYPE_META: Record<string, { label: string; icon: typeof FileText; cls: string }> = {
  article: { label: "文章", icon: Newspaper, cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  doc: { label: "文档", icon: FileType, cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  image: { label: "图片", icon: Image, cls: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  note: { label: "金句", icon: FileText, cls: "bg-green-500/10 text-green-600 dark:text-green-400" },
}

/** 取类型元信息，未知类型回落中性样式 */
function typeMeta(type: string): { label: string; icon: typeof FileText; cls: string } {
  return TYPE_META[type] ?? { label: type, icon: FileText, cls: "bg-muted text-muted-foreground" }
}

export function LibraryFilesTab({ search }: { search: string }) {
  const [items, setItems] = useState<KbItem[]>([])
  const [filterType, setFilterType] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = (await window.nexa.kbList({ limit: 200 })) as KbItem[]
      // 主进程 tags 可能为 null（未打标签条目），统一归一为空数组供渲染使用
      setItems(res.map((i) => ({ ...i, keywords: i.keywords ?? [], tags: i.tags ?? [] })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadItems() }, [loadItems])

  /** 待删除条目（null 表示确认弹框关闭） */
  const [pendingDelete, setPendingDelete] = useState<KbItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  /** 详情条目：卡片文案被 line-clamp 截断，点击卡片查看全文 */
  const [detail, setDetail] = useState<KbItem | null>(null)
  /** 大图预览条目（图片类型；shadcn Dialog 组合实现） */
  const [lightbox, setLightbox] = useState<KbItem | null>(null)

  const handleDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const id = pendingDelete.id
      await window.nexa.kbDelete(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      setPendingDelete(null)
      setDetail((d) => (d?.id === id ? null : d))
    } finally {
      setDeleting(false)
    }
  }

  // 类型计数
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) {
      counts[item.type] = (counts[item.type] ?? 0) + 1
    }
    return counts
  }, [items])

  // 搜索 + 类型过滤
  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filterType && item.type !== filterType) return false
      if (q && !item.title.toLowerCase().includes(q) && !item.summary.toLowerCase().includes(q) && !item.keywords.some((k) => k.toLowerCase().includes(q))) return false
      return true
    })
  }, [items, filterType, q])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div className="flex h-full flex-col">
      {/* 横向筛选条: 类型 chips */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
        <FilterChip active={!filterType} onClick={() => setFilterType(null)} label="全部" count={items.length} />
        {Object.entries(TYPE_META).map(([key, meta]) => (
          <FilterChip
            key={key}
            active={filterType === key}
            onClick={() => setFilterType(filterType === key ? null : key)}
            label={meta.label}
            count={typeCounts[key] ?? 0}
          />
        ))}
      </div>

      {/* 卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{items.length === 0 ? "资料库为空" : "无匹配结果"}</p>
            <p className="text-xs text-muted-foreground/70">{items.length === 0 ? "对话中可让 Agent 入库，或用浏览器插件采集" : "尝试调整搜索或筛选条件"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const meta = typeMeta(item.type)
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setDetail(item)
                    }
                  }}
                  className="group rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-3">
                    {item.type === "image" ? (
                      /* 图片类型：用原图缩略图替代图标，点击看大图（stopPropagation 不触发卡片详情） */
                      <button
                        type="button"
                        title="查看大图"
                        aria-label="查看大图"
                        onClick={(e) => {
                          e.stopPropagation()
                          setLightbox(item)
                        }}
                        className="shrink-0 overflow-hidden rounded-lg border border-border outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <KbImage id={item.id} alt={item.title} className="h-14 w-14 object-cover" />
                      </button>
                    ) : (
                      <meta.icon className="h-6 w-6 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", meta.cls)}>{meta.label}</span>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(item.created_at)}</span>
                      </div>
                      <div className="line-clamp-2 text-sm font-semibold leading-snug">{item.title}</div>
                      {item.summary && <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.summary}</div>}
                      {item.tags.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {item.tags.slice(0, 5).map((t) => (
                            <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="删除"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingDelete(item)
                      }}
                      className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 详情弹框：卡片文案限 2 行，这里展示完整标题/摘要/关键词/标签/来源 */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null) }}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <div className="mb-1 flex items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", typeMeta(detail.type).cls)}>
                    {typeMeta(detail.type).label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{timeAgo(detail.created_at)}</span>
                </div>
                <DialogTitle className="break-words text-left leading-snug">{detail.title}</DialogTitle>
                <DialogDescription className="sr-only">资料条目详情</DialogDescription>
              </DialogHeader>

              {detail.summary ? (
                <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                  {detail.summary}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/70">（无摘要）</p>
              )}

              {detail.keywords.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">关键词</div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.keywords.map((k) => (
                      <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {detail.tags.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">标签</div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {detail.source_url && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">来源</div>
                  <a
                    href={detail.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 break-all text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {detail.source_url}
                  </a>
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setPendingDelete(detail)
                    setDetail(null)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDetail(null)}>
                  关闭
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认弹框（Electron 不支持 window.confirm，改用 shadcn Dialog） */}
      <Dialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除这条资料？</DialogTitle>
            <DialogDescription>
              {pendingDelete?.title ? `「${pendingDelete.title}」删除后不可恢复。` : "删除后不可恢复。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 大图预览（官方 shadcn registry 无 lightbox 组件，用 Dialog + Button 组合实现） */}
      <Dialog open={!!lightbox} onOpenChange={(open) => { if (!open) setLightbox(null) }}>
        <DialogContent
          hideClose
          className="w-auto max-w-[92vw] border-none bg-transparent p-0 shadow-none sm:rounded-none"
        >
          {lightbox && (
            <div className="relative flex flex-col items-center">
              <Button
                variant="secondary"
                size="icon"
                aria-label="关闭"
                title="关闭"
                onClick={() => setLightbox(null)}
                className="absolute -right-2 -top-2 z-10 h-8 w-8 rounded-full shadow-md"
              >
                <X className="h-4 w-4" />
              </Button>
              <DialogHeader className="sr-only">
                <DialogTitle>{lightbox.title}</DialogTitle>
                <DialogDescription>图片预览</DialogDescription>
              </DialogHeader>
              {/* 小图按原始尺寸显示不放大；大图等比缩到最大显示区域内 */}
              <KbImage
                id={lightbox.id}
                alt={lightbox.title}
                className="h-auto w-auto max-h-[80vh] max-w-[92vw] rounded-lg border border-border object-contain"
              />
              <p className="mt-3 max-w-[92vw] truncate text-xs text-muted-foreground">{lightbox.title}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * 知识库图片（按条目 id 经主进程读原图 dataURL）。
 * 加载中 / 读取失败时回落为占位块，避免卡片布局跳动。
 */
function KbImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  /** undefined = 加载中；null = 不可用 */
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void window.nexa
      .kbImageRead(id)
      .then((d: unknown) => {
        if (alive) setDataUrl((d as string | null) ?? null)
      })
      .catch(() => {
        if (alive) setDataUrl(null)
      })
    return () => {
      alive = false
    }
  }, [id])

  if (dataUrl) return <img src={dataUrl} alt={alt} className={className} />
  return (
    <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
      <Image className="h-4 w-4" />
    </div>
  )
}

/** 筛选条圆角 chip（类型筛选） */
function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
      <span className={active ? "text-primary/70" : "text-muted-foreground/60"}>{count}</span>
    </button>
  )
}

