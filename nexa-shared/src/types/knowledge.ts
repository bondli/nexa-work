/**
 * 知识库与笔记共享类型
 */

export type KnowledgeType = "note" | "article" | "image" | "doc"

/** 知识库条目 */
export interface KnowledgeItem {
  id: string
  type: KnowledgeType
  title: string
  summary: string
  keywords: string[]
  tags: string[]
  source_url: string | null
  file_path: string | null
  workspace_id: string | null
  created_at: number
  updated_at: number
}

/** 笔记状态 */
export type NoteStatus = "draft" | "submitted"

/** 笔记条目 */
export interface Note {
  id: string
  title: string
  content: string
  status: NoteStatus
  category: string
  tags: string[]
  linked_session: string | null
  created_at: number
  updated_at: number
}

/** 笔记分类 */
export interface NoteCategory {
  id: string
  name: string
  icon: string
  sort_order: number
  is_preset: boolean
  created_at: number
  note_count: number
}

/** 笔记列表查询参数 */
export interface NoteListParams {
  category?: string
  status?: NoteStatus
  search?: string
}

/** 笔记创建参数 */
export interface NoteCreateParams {
  title: string
  status?: NoteStatus
  category?: string
  tags?: string[]
}

/** 笔记更新参数 */
export interface NoteUpdateParams {
  title?: string
  content?: string
  status?: NoteStatus
  category?: string
  tags?: string[]
}
