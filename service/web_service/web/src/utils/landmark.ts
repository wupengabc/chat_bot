import {get} from './request'

export type LandmarkSortBy = 'name' | 'owner' | 'visits' | 'updated_at' | 'first_seen_at'
export type LandmarkSortOrder = 'asc' | 'desc'

export interface LandmarkListItem {
  id: number
  name: string
  description: string
  owner: string
  visits: number
  price: string
  item_id: string
  first_seen_at: string
  updated_at: string
}

export interface LandmarkFilters {
  keyword?: string
  name?: string
  owner?: string
  item_id?: string
  min_visits?: string
  max_visits?: string
  updated_from?: string
  updated_to?: string
  sort_by: LandmarkSortBy
  sort_order: LandmarkSortOrder
}

interface LandmarkListResponse {
  success: boolean
  landmarks: LandmarkListItem[]
  summary: {total: number; visits: number}
  pagination: {page: number; limit: number; total: number; total_pages: number; has_previous: boolean; has_next: boolean}
}

export function landmarkListRequest(page: number, limit: number, filters: LandmarkFilters) {
  const params = new URLSearchParams({page: String(page), limit: String(limit), sort_by: filters.sort_by, sort_order: filters.sort_order})
  for (const key of ['keyword', 'name', 'owner', 'item_id', 'min_visits', 'max_visits', 'updated_from', 'updated_to'] as const) {
    const value = filters[key]?.trim()
    if (value) params.set(key, value)
  }
  return get<LandmarkListResponse>(`/api/landmarks?${params.toString()}`)
}
