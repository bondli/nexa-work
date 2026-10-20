/**
 * 笔记相关共享类型（桌面端 + 浏览器插件共用）
 * 注意：此文件仅承载类型，两端各自拷贝维护（避免构建期跨包引用）
 */

export interface NoteRow {
  id: string
  title: string
  content: string
  category: string | null
  status: "draft" | "submitted"
  tags: string | null
  created_at: number
  updated_at: number
}

export interface NoteCategoryWithCount {
  id: string
  name: string
  icon: string | null
  note_count: number
}

export interface NoteListResponse {
  notes: NoteRow[]
  total: number
}
