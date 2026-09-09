import {del, get, patch, post} from './request'
import {useAuthStore} from '../stores/auth'

export type ShopSellType = 'sell' | 'buy'

export interface ShopListItem {
  id: number
  shopname: string
  create_at: string
  new_batch_id: string | null
}

export interface ShopPrice {
  id: number
  item_id: string
  player: string | null
  sell_type: ShopSellType
  count: string | null
  position: string | null
  create_at: string
  price: number
}

export interface ShopSnapshot {
  shop_name: string
  batch_id: string
  create_at: string
  prices: ShopPrice[]
}

export interface ShopPriceHistoryEntry extends ShopPrice {
  shop: string
  batch_id: string
}

export interface ShopAverageResult {
  average: number
  shop_count: number
  shops: string[]
  adjusted_shops: string[]
  adjusted_count: number
  outlier_count: number
  outlier_shops: string[]
}

interface ShopListResponse {
  success: boolean
  shops: ShopListItem[]
}

interface ShopInfoResponse {
  success: boolean
  shop: ShopSnapshot
}

interface ShopItemHistoryResponse {
  success: boolean
  item: string
  shop: string
  history: ShopPriceHistoryEntry[]
}

export interface ShopAverageResponse {
  success: boolean
  item: string
  sell_type: ShopSellType
  charged_point: number
  point: number
  average: ShopAverageResult | null
}

export function shopListRequest() {
  return get<ShopListResponse>('/api/shop/list')
}

export function shopInfoRequest(name: string) {
  const params = new URLSearchParams({name: name.trim()})
  return get<ShopInfoResponse>(`/api/shop/info?${params.toString()}`)
}

export function shopItemHistoryRequest(item: string, shop: string) {
  const params = new URLSearchParams({item: item.trim(), shop: shop.trim()})
  return get<ShopItemHistoryResponse>(`/api/shop/item_history?${params.toString()}`)
}

export function shopAverageRequest(item: string, type: ShopSellType) {
  const params = new URLSearchParams({item: item.trim(), type})
  return get<ShopAverageResponse>(`/api/shop/avg?${params.toString()}`)
}

export async function shopUpdateDownload(shopName: string): Promise<Blob> {
  const token = useAuthStore().resourceToken
  const response = await fetch('/api/shop/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
    body: JSON.stringify({shop_name: shopName}),
  })
  if (!response.ok) {
    const text = await response.text()
    let message: string
    try { message = JSON.parse(text).message || `请求失败（${response.status}）` } catch { message = text || `请求失败（${response.status}）` }
    throw new Error(message)
  }
  return response.blob()
}

// ── Admin Shop API ──────────────────────────────────────────────

export interface AdminShopItem {
  shop_name: string
  new_batch_id: string | null
  listed_at: string
  latest_update: string | null
  price_count: number
  batch_count: number
  item_count: number
  sell_count: number
  buy_count: number
  players: string[]
}

export interface AdminShopStats {
  shops: number
  prices: number
  batches: number
  sell: number
  buy: number
  latest_update: string | null
}

export interface AdminShopPagination {
  page: number
  limit: number
  total: number
  total_pages: number
  has_previous: boolean
  has_next: boolean
}

export interface AdminShopListResponse {
  success: boolean
  shops: AdminShopItem[]
  stats: AdminShopStats
  pagination: AdminShopPagination
}

export interface AdminShopBatch {
  batch_id: string
  create_at: string
  record_count: number
  item_count: number
  sell_count: number
  buy_count: number
  players: string[]
}

export interface AdminShopHistoryResponse {
  success: boolean
  shop: string
  batches: AdminShopBatch[]
  pagination: AdminShopPagination
}

export interface AdminShopSyncResponse {
  success: boolean
  inserted?: number
  updated?: number
  deleted?: number
  total?: number
  message?: string
}

export interface AdminShopDeleteResponse {
  success: boolean
  deleted?: number
  message?: string
}

export interface AdminShopBatchDeleteResponse {
  success: boolean
  deleted?: number
  new_batch_id?: string | null
  shop_removed?: boolean
  message?: string
}

export interface AdminShopBatchPriceResponse {
  success: boolean
  batch: ShopSnapshot
}

export interface AdminShopItemPrice extends ShopPriceHistoryEntry {}

export interface AdminShopItemPricesResponse {
  success: boolean
  item: string
  sell_type: ShopSellType | null
  prices: AdminShopItemPrice[]
}

export interface AdminShopPriceUpdateResponse {
  success: boolean
  price: ShopPrice
}

export interface AdminShopPriceDeleteResponse {
  success: boolean
  deleted?: number
  new_batch_id?: string | null
  shop_removed?: boolean
}

export interface AdminShopFilters {
  shop_name?: string
  player?: string
  item_id?: string
  sell_type?: ShopSellType
  updated_from?: string
  updated_to?: string
  sort_by?: 'shop_name' | 'updated_at' | 'item_count' | 'price_count'
  sort_order?: 'asc' | 'desc'
}

export function adminShopListRequest(page: number, limit: number, filters: AdminShopFilters) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  if (filters.shop_name) params.set('shop_name', filters.shop_name)
  if (filters.player) params.set('player', filters.player)
  if (filters.item_id) params.set('item_id', filters.item_id)
  if (filters.sell_type) params.set('sell_type', filters.sell_type)
  if (filters.updated_from) params.set('updated_from', filters.updated_from)
  if (filters.updated_to) params.set('updated_to', filters.updated_to)
  if (filters.sort_by) params.set('sort_by', filters.sort_by)
  if (filters.sort_order) params.set('sort_order', filters.sort_order)
  return get<AdminShopListResponse>(`/api/admin/shops?${params.toString()}`)
}

export function adminShopHistoryRequest(shop: string, page: number, limit: number) {
  const params = new URLSearchParams({page: String(page), limit: String(limit)})
  return get<AdminShopHistoryResponse>(`/api/admin/shops/${encodeURIComponent(shop)}/history?${params.toString()}`)
}

export function adminShopSyncRequest() {
  return post<AdminShopSyncResponse>('/api/admin/shops/sync', {})
}

export function adminShopDeleteRequest(shop: string) {
  return del<AdminShopDeleteResponse>(`/api/admin/shops/${encodeURIComponent(shop)}`)
}

export function adminShopBatchDeleteRequest(shop: string, batchId: string) {
  return del<AdminShopBatchDeleteResponse>(`/api/admin/shops/${encodeURIComponent(shop)}/batches/${encodeURIComponent(batchId)}`)
}

export function adminShopBatchPricesRequest(shop: string, batchId: string) {
  return get<AdminShopBatchPriceResponse>(`/api/admin/shops/${encodeURIComponent(shop)}/batches/${encodeURIComponent(batchId)}/prices`)
}

export function adminShopPriceUpdateRequest(shop: string, batchId: string, priceId: number, price: number) {
  return patch<AdminShopPriceUpdateResponse>(`/api/admin/shops/${encodeURIComponent(shop)}/batches/${encodeURIComponent(batchId)}/prices/${priceId}`, {price})
}

export function adminShopPriceDeleteRequest(shop: string, batchId: string, priceId: number) {
  return del<AdminShopPriceDeleteResponse>(`/api/admin/shops/${encodeURIComponent(shop)}/batches/${encodeURIComponent(batchId)}/prices/${priceId}`)
}

export function adminShopBatchItemDeleteRequest(shop: string, batchId: string, itemId: string, sellType?: ShopSellType) {
  const params = new URLSearchParams({item_id: itemId})
  if (sellType) params.set('sell_type', sellType)
  return del<AdminShopPriceDeleteResponse>(`/api/admin/shops/${encodeURIComponent(shop)}/batches/${encodeURIComponent(batchId)}/items?${params.toString()}`)
}

export function adminShopItemPricesRequest(itemId: string, sellType?: ShopSellType) {
  const params = new URLSearchParams({item_id: itemId.trim()})
  if (sellType) params.set('sell_type', sellType)
  return get<AdminShopItemPricesResponse>(`/api/admin/shops/item-prices?${params.toString()}`)
}
