/**
 * 记忆系统共享类型
 */

export type MemoryLayer = "preference" | "behavior" | "knowledge"

export interface MemoryItem {
  id: string
  layer: MemoryLayer
  key: string
  value: string
  scope: string
  created_at: number
  updated_at: number
  last_accessed_at: number
  access_count: number
}
