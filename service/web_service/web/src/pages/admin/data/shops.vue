<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import BaseDialog from '../../../components/BaseDialog.vue'
import BaseSelect from '../../../components/BaseSelect.vue'
import BaseTooltip from '../../../components/BaseTooltip.vue'
import TimeRangePicker, {type TimeRangeValue} from '../../../components/TimeRangePicker.vue'
import {
  adminShopBatchDeleteRequest,
  adminShopBatchItemDeleteRequest,
  adminShopBatchPricesRequest,
  adminShopDeleteRequest,
  adminShopHistoryRequest,
  adminShopItemPricesRequest,
  adminShopListRequest,
  adminShopPriceDeleteRequest,
  adminShopPriceUpdateRequest,
  adminShopSyncRequest,
  shopInfoRequest,
  shopItemHistoryRequest,
  shopUpdateDownload,
  type AdminShopBatch,
  type AdminShopItem,
  type AdminShopItemPrice,
  type AdminShopStats,
  type ShopPrice,
  type ShopPriceHistoryEntry,
  type ShopSellType,
  type ShopSnapshot,
} from '../../../utils/shop'
import {getItemIcon} from '../../../utils/itemIcon'

type PageLimit = '10' | '20' | '50' | '100'
type SortField = 'shop_name' | 'updated_at' | 'item_count' | 'price_count'
type SortOrder = 'asc' | 'desc'

interface ShopPriceGroup { key: string; item_id: string; sell_type: ShopSellType; entries: ShopPrice[] }

const typeOptions = ['全部类型', '出售', '收购']
const queryTypeOptions = ['出售', '收购']
const pageLimitOptions: PageLimit[] = ['10', '20', '50', '100']
const sortOptions = ['商店名', '更新时间', '物品数', '记录数']
const sortMap: Record<string, SortField> = {商店名: 'shop_name', 更新时间: 'updated_at', 物品数: 'item_count', 记录数: 'price_count'}

const shops = ref<AdminShopItem[]>([])
const stats = ref<AdminShopStats | null>(null)
const listLoading = ref(false)
const listLoaded = ref(false)
const listError = ref('')
const notice = ref('')
const shopSearch = ref('')
const playerSearch = ref('')
const itemSearchFilter = ref('')
const sellTypeFilter = ref('全部类型')
const updatedRange = ref<TimeRangeValue>({from: '', to: ''})
const sortDisplay = ref('商店名')
const sortField = ref<SortField>('shop_name')
const sortOrder = ref<SortOrder>('asc')
const pageLimit = ref<PageLimit>('10')
const page = ref(1)
const pageInput = ref('1')
const total = ref(0)
const totalPages = ref(1)
const hasPrevious = ref(false)
const hasNext = ref(false)
const syncLoading = ref(false)
const syncResultOpen = ref(false)
const syncResultTitle = ref('')
const syncResultMessage = ref('')
const syncResultFailed = ref(false)
const updateLoading = ref(false)
const updateShopName = ref('')
const shopUpdateResultOpen = ref(false)
const shopUpdateResultTitle = ref('')
const shopUpdateResultMessage = ref('')
const shopUpdateResultFailed = ref(false)
let listSerial = 0

const dialogOpen = ref(false)
const selectedShop = ref('')
const snapshot = ref<ShopSnapshot | null>(null)
const shopLoading = ref(false)
const shopError = ref('')
const dialogTab = ref<'prices' | 'batches'>('prices')
const itemSearch = ref('')
const typeFilter = ref('全部类型')
const selectedItem = ref('')
const selectedSellType = ref<ShopSellType>('sell')
const history = ref<ShopPriceHistoryEntry[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const iconCache = ref<Record<string, string>>({})
let shopSerial = 0
let historySerial = 0

const batches = ref<AdminShopBatch[]>([])
const batchLoading = ref(false)
const batchError = ref('')
const batchPage = ref(1)
const batchTotalPages = ref(1)
let batchSerial = 0

const deleteShopOpen = ref(false)
const deleteShopTarget = ref<AdminShopItem | null>(null)
const deleteShopLoading = ref(false)
const deleteShopError = ref('')
const deleteBatchOpen = ref(false)
const deleteBatchTarget = ref<AdminShopBatch | null>(null)
const deleteBatchLoading = ref(false)
const deleteBatchError = ref('')

const editPriceOpen = ref(false)
const editPriceTarget = ref<ShopPrice | null>(null)
const editPriceValue = ref('')
const editPriceLoading = ref(false)
const editPriceError = ref('')
const deletePriceOpen = ref(false)
const deletePriceTarget = ref<ShopPrice | null>(null)
const deletePriceLoading = ref(false)
const deletePriceError = ref('')
const deleteItemOpen = ref(false)
const deleteItemTarget = ref<ShopPriceGroup | null>(null)
const deleteItemLoading = ref(false)
const deleteItemError = ref('')

const itemQueryOpen = ref(false)
const itemQueryConfirmOpen = ref(false)
const itemQueryInput = ref('')
const itemQueryType = ref('出售')
const itemQueryLoading = ref(false)
const itemQueryError = ref('')
const itemQueryResult = ref<AdminShopItemPrice[]>([])
const itemQueryName = ref('')

const itemQueryStats = computed(() => {
  const prices = itemQueryResult.value.map(entry => entry.price).filter(Number.isFinite)
  const shops = new Set(itemQueryResult.value.map(entry => entry.shop.toLocaleLowerCase())).size
  if (!prices.length) return {shops, records: itemQueryResult.value.length, min: null as number | null, max: null as number | null, average: null as number | null}
  return {shops, records: itemQueryResult.value.length, min: Math.min(...prices), max: Math.max(...prices), average: prices.reduce((sum, price) => sum + price, 0) / prices.length}
})

function iconPath(name: 'store' | 'refresh' | 'search' | 'arrow' | 'package' | 'trash' | 'sync' | 'sliders' | 'edit' | 'chart') {
  const icons = {
    store: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    package: '<path d="M12 22V12m8.27 6.27L22 20m-1-9.502V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"/><path d="M3.29 7 12 12l8.71-5M7.5 4.27l8.997 5.148"/><circle cx="18.5" cy="16.5" r="2.5"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    sync: '<path d="M4 7h11a4 4 0 0 1 0 8H8"/><path d="m8 11-4-4 4-4"/><path d="M20 17H9a4 4 0 0 1 0-8h7"/><path d="m16 13 4 4-4 4"/>',
    sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/>',
  }
  return icons[name]
}

function formatDate(value?: string | null) {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(date)
}
function shortBatch(value: string | null | undefined) { return value ? `${value.slice(0, 8)}...${value.slice(-4)}` : 'NO BATCH' }
function formatPrice(value: number | null | undefined) { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-' }
function filterSellType(value: string): ShopSellType | undefined { return value === '出售' ? 'sell' : value === '收购' ? 'buy' : undefined }

async function loadIcons(items: string[]) {
  const unique = [...new Set(items.map(item => item.trim().toLowerCase()).filter(Boolean))]
  const entries = await Promise.all(unique.map(async item => [item, await getItemIcon(item)] as const))
  iconCache.value = {...iconCache.value, ...Object.fromEntries(entries)}
}
function itemIcon(itemId: string) { return iconCache.value[itemId.trim().toLowerCase()] || '' }
function itemIconOrPlaceholder(itemId: string) {
  return itemIcon(itemId) || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>')}`
}

const filteredPriceGroups = computed<ShopPriceGroup[]>(() => {
  const query = itemSearch.value.trim().toLocaleLowerCase()
  const sellType = filterSellType(typeFilter.value)
  const groups = new Map<string, ShopPriceGroup>()
  for (const price of snapshot.value?.prices || []) {
    if (query && !price.item_id.toLocaleLowerCase().includes(query) && !price.player?.toLocaleLowerCase().includes(query) && !price.position?.toLocaleLowerCase().includes(query)) continue
    if (sellType && price.sell_type !== sellType) continue
    const key = `${price.item_id.toLocaleLowerCase()}\u0000${price.sell_type}`
    const group = groups.get(key)
    if (group) group.entries.push(price)
    else groups.set(key, {key, item_id: price.item_id, sell_type: price.sell_type, entries: [price]})
  }
  return Array.from(groups.values()).sort((a, b) => a.item_id.localeCompare(b.item_id, 'zh-CN'))
})
const snapshotStats = computed(() => {
  const prices = snapshot.value?.prices || []
  return {items: new Set(prices.map(price => price.item_id.toLocaleLowerCase())).size, sell: prices.filter(price => price.sell_type === 'sell').length, buy: prices.filter(price => price.sell_type === 'buy').length}
})
const selectedPriceGroup = computed(() => {
  if (!selectedItem.value) return null
  const entries = (snapshot.value?.prices || []).filter(price => price.item_id === selectedItem.value && price.sell_type === selectedSellType.value)
  return entries.length ? {key: `${selectedItem.value}\u0000${selectedSellType.value}`, item_id: selectedItem.value, sell_type: selectedSellType.value, entries} : null
})
const selectedHistory = computed(() => history.value.filter(entry => entry.sell_type === selectedSellType.value))
const chartEntries = computed(() => selectedHistory.value.slice(0, 40).reverse())
const chartPoints = computed(() => {
  const values = chartEntries.value.map(entry => Number(entry.price)).filter(Number.isFinite)
  if (!values.length) return ''
  const min = Math.min(...values), max = Math.max(...values), span = max - min
  return values.map((value, index) => `${values.length === 1 ? 300 : 24 + index * 552 / (values.length - 1)},${span === 0 ? 82 : 146 - (value - min) * 124 / span}`).join(' ')
})
const chartMin = computed(() => chartEntries.value.length ? Math.min(...chartEntries.value.map(entry => entry.price)) : null)
const chartMax = computed(() => chartEntries.value.length ? Math.max(...chartEntries.value.map(entry => entry.price)) : null)
function groupPrice(group: ShopPriceGroup) {
  const prices = group.entries.map(entry => entry.price)
  const min = Math.min(...prices), max = Math.max(...prices)
  return min === max ? formatPrice(min) : `${formatPrice(min)} - ${formatPrice(max)}`
}

async function loadShops(nextPage = 1) {
  const serial = ++listSerial
  listLoading.value = true
  listError.value = ''
  try {
    const result = await adminShopListRequest(nextPage, Number(pageLimit.value), {
      shop_name: shopSearch.value,
      player: playerSearch.value,
      item_id: itemSearchFilter.value,
      sell_type: filterSellType(sellTypeFilter.value),
      updated_from: updatedRange.value.from,
      updated_to: updatedRange.value.to,
      sort_by: sortField.value,
      sort_order: sortOrder.value,
    })
    if (serial !== listSerial) return
    shops.value = result.shops
    stats.value = result.stats
    page.value = result.pagination.page
    pageInput.value = String(result.pagination.page)
    total.value = result.pagination.total
    totalPages.value = result.pagination.total_pages
    hasPrevious.value = result.pagination.has_previous
    hasNext.value = result.pagination.has_next
    listLoaded.value = true
  } catch (error) {
    if (serial !== listSerial) return
    shops.value = []
    stats.value = null
    listError.value = error instanceof Error ? error.message : '商店列表加载失败'
  } finally {
    if (serial === listSerial) listLoading.value = false
  }
}
function searchShops() { void loadShops(1) }
function clearFilters() {
  shopSearch.value = ''; playerSearch.value = ''; itemSearchFilter.value = ''; sellTypeFilter.value = '全部类型'
  updatedRange.value = {from: '', to: ''}; sortDisplay.value = '商店名'; sortField.value = 'shop_name'; sortOrder.value = 'asc'
  searchShops()
}
function toggleSortOrder() { sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'; searchShops() }
async function syncShops() {
  syncLoading.value = true
  try {
    const result = await adminShopSyncRequest()
    syncResultTitle.value = '商店目录同步完成'
    syncResultMessage.value = `新增 ${result.inserted || 0}，更新 ${result.updated || 0}，删除 ${result.deleted || 0}，当前共 ${result.total || 0} 家商店。`
    syncResultFailed.value = false
    syncResultOpen.value = true
    void loadShops(page.value)
  } catch (error) {
    syncResultTitle.value = '商店目录同步失败'
    syncResultMessage.value = error instanceof Error ? error.message : '同步失败'
    syncResultFailed.value = true
    syncResultOpen.value = true
  } finally {
    syncLoading.value = false
  }
}
async function scanShop(shop: string) {
  updateLoading.value = true
  updateShopName.value = shop
  try {
    const blob = await shopUpdateDownload(shop)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${shop}_商店价格.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    shopUpdateResultTitle.value = '商店更新完成'
    shopUpdateResultMessage.value = `${shop} 的最新价格已扫描完成，Excel 报告已下载。`
    shopUpdateResultFailed.value = false
    shopUpdateResultOpen.value = true
    void loadShops(1)
  } catch (error) {
    shopUpdateResultTitle.value = '商店更新失败'
    shopUpdateResultMessage.value = error instanceof Error ? error.message : '更新商店失败'
    shopUpdateResultFailed.value = true
    shopUpdateResultOpen.value = true
  } finally {
    updateLoading.value = false
    updateShopName.value = ''
  }
}
function closeShopUpdateProgress() {}

function setSnapshot(next: ShopSnapshot) {
  snapshot.value = next
  if (!next.prices.some(price => price.item_id === selectedItem.value && price.sell_type === selectedSellType.value)) {
    selectedItem.value = ''
    history.value = []
  }
  void loadIcons(next.prices.map(price => price.item_id))
}
async function openShop(shop: string) {
  const serial = ++shopSerial
  historySerial++
  batchSerial++
  selectedShop.value = shop
  snapshot.value = null
  history.value = []
  batches.value = []
  shopError.value = ''
  itemSearch.value = ''
  typeFilter.value = '全部类型'
  selectedItem.value = ''
  dialogTab.value = 'prices'
  dialogOpen.value = true
  shopLoading.value = true
  try {
    const result = await shopInfoRequest(shop)
    if (serial !== shopSerial) return
    setSnapshot(result.shop)
  } catch (error) {
    if (serial !== shopSerial) return
    shopError.value = error instanceof Error ? error.message : '商店价格加载失败'
  } finally {
    if (serial === shopSerial) shopLoading.value = false
  }
}
async function openBatchPrices(batchId: string) {
  if (!selectedShop.value) return
  const serial = ++shopSerial
  historySerial++
  shopLoading.value = true
  shopError.value = ''
  dialogTab.value = 'prices'
  try {
    const result = await adminShopBatchPricesRequest(selectedShop.value, batchId)
    if (serial !== shopSerial) return
    setSnapshot(result.batch)
  } catch (error) {
    if (serial !== shopSerial) return
    shopError.value = error instanceof Error ? error.message : '批次价格加载失败'
  } finally {
    if (serial === shopSerial) shopLoading.value = false
  }
}
function closeShop() { shopSerial++; historySerial++; batchSerial++; dialogOpen.value = false }
async function selectGroup(group: ShopPriceGroup) {
  const first = group.entries[0]
  if (!first || historyLoading.value) return
  const serial = ++historySerial
  selectedItem.value = first.item_id
  selectedSellType.value = first.sell_type
  history.value = []
  historyError.value = ''
  historyLoading.value = true
  try {
    const result = await shopItemHistoryRequest(first.item_id, selectedShop.value)
    if (serial !== historySerial) return
    history.value = result.history
  } catch (error) {
    if (serial !== historySerial) return
    historyError.value = error instanceof Error ? error.message : '历史价格加载失败'
  } finally {
    if (serial === historySerial) historyLoading.value = false
  }
}
function switchDialogTab(tab: 'prices' | 'batches') {
  dialogTab.value = tab
  if (tab === 'batches' && !batches.value.length && !batchLoading.value) void loadBatchHistory(1)
}
async function loadBatchHistory(nextPage = 1) {
  const serial = ++batchSerial
  batchLoading.value = true
  batchError.value = ''
  try {
    const result = await adminShopHistoryRequest(selectedShop.value, nextPage, 10)
    if (serial !== batchSerial) return
    batches.value = result.batches
    batchPage.value = result.pagination.page
    batchTotalPages.value = result.pagination.total_pages
  } catch (error) {
    if (serial !== batchSerial) return
    batchError.value = error instanceof Error ? error.message : '批次历史加载失败'
  } finally {
    if (serial === batchSerial) batchLoading.value = false
  }
}

function refreshAfterMutation(result?: {shop_removed?: boolean}) {
  if (result?.shop_removed) closeShop()
  else if (snapshot.value) void openBatchPrices(snapshot.value.batch_id)
  void loadBatchHistory(batchPage.value)
  void loadShops(page.value)
}
function openDeleteShop(shop: AdminShopItem) { deleteShopTarget.value = shop; deleteShopError.value = ''; deleteShopOpen.value = true }
async function confirmDeleteShop() {
  if (!deleteShopTarget.value) return
  deleteShopLoading.value = true
  deleteShopError.value = ''
  try {
    await adminShopDeleteRequest(deleteShopTarget.value.shop_name)
    deleteShopOpen.value = false
    if (selectedShop.value.toLowerCase() === deleteShopTarget.value.shop_name.toLowerCase()) closeShop()
    void loadShops(1)
  } catch (error) {
    deleteShopError.value = error instanceof Error ? error.message : '删除失败'
  } finally {
    deleteShopLoading.value = false
  }
}
function openDeleteBatch(batch: AdminShopBatch) { deleteBatchTarget.value = batch; deleteBatchError.value = ''; deleteBatchOpen.value = true }
async function confirmDeleteBatch() {
  if (!deleteBatchTarget.value) return
  deleteBatchLoading.value = true
  deleteBatchError.value = ''
  try {
    const result = await adminShopBatchDeleteRequest(selectedShop.value, deleteBatchTarget.value.batch_id)
    deleteBatchOpen.value = false
    refreshAfterMutation(result)
  } catch (error) {
    deleteBatchError.value = error instanceof Error ? error.message : '删除批次失败'
  } finally {
    deleteBatchLoading.value = false
  }
}
function openEditPrice(entry: ShopPrice) {
  editPriceTarget.value = entry
  editPriceValue.value = String(entry.price)
  editPriceError.value = ''
  editPriceOpen.value = true
}
async function confirmEditPrice() {
  if (!snapshot.value || !editPriceTarget.value) return
  const price = Number(editPriceValue.value)
  if (!Number.isFinite(price) || price <= 0) { editPriceError.value = '价格必须大于 0'; return }
  editPriceLoading.value = true
  editPriceError.value = ''
  try {
    await adminShopPriceUpdateRequest(selectedShop.value, snapshot.value.batch_id, editPriceTarget.value.id, price)
    editPriceOpen.value = false
    void openBatchPrices(snapshot.value.batch_id)
    void loadShops(page.value)
  } catch (error) {
    editPriceError.value = error instanceof Error ? error.message : '改价失败'
  } finally {
    editPriceLoading.value = false
  }
}
function openDeletePrice(entry: ShopPrice) { deletePriceTarget.value = entry; deletePriceError.value = ''; deletePriceOpen.value = true }
async function confirmDeletePrice() {
  if (!snapshot.value || !deletePriceTarget.value) return
  deletePriceLoading.value = true
  deletePriceError.value = ''
  try {
    const result = await adminShopPriceDeleteRequest(selectedShop.value, snapshot.value.batch_id, deletePriceTarget.value.id)
    deletePriceOpen.value = false
    refreshAfterMutation(result)
  } catch (error) {
    deletePriceError.value = error instanceof Error ? error.message : '删除价格失败'
  } finally {
    deletePriceLoading.value = false
  }
}
function openDeleteItem(group: ShopPriceGroup) { deleteItemTarget.value = group; deleteItemError.value = ''; deleteItemOpen.value = true }
async function confirmDeleteItem() {
  if (!snapshot.value || !deleteItemTarget.value) return
  deleteItemLoading.value = true
  deleteItemError.value = ''
  try {
    const result = await adminShopBatchItemDeleteRequest(selectedShop.value, snapshot.value.batch_id, deleteItemTarget.value.item_id, deleteItemTarget.value.sell_type)
    deleteItemOpen.value = false
    refreshAfterMutation(result)
  } catch (error) {
    deleteItemError.value = error instanceof Error ? error.message : '删除物品失败'
  } finally {
    deleteItemLoading.value = false
  }
}
function openItemQuery(item?: string) {
  itemQueryInput.value = item || ''
  itemQueryType.value = selectedSellType.value === 'buy' ? '收购' : '出售'
  itemQueryName.value = ''
  itemQueryResult.value = []
  itemQueryError.value = ''
  if (item) void queryItemPrices()
  else itemQueryConfirmOpen.value = true
}
async function queryItemPrices() {
  const item = itemQueryInput.value.trim()
  if (!item) { itemQueryError.value = '请输入物品名'; return }
  itemQueryLoading.value = true
  itemQueryError.value = ''
  itemQueryConfirmOpen.value = false
  itemQueryOpen.value = true
  try {
    const result = await adminShopItemPricesRequest(item, filterSellType(itemQueryType.value) || 'sell')
    itemQueryName.value = result.item
    itemQueryResult.value = result.prices
    void loadIcons([result.item])
  } catch (error) {
    itemQueryError.value = error instanceof Error ? error.message : '查询失败'
  } finally {
    itemQueryLoading.value = false
  }
}

watch(sortDisplay, value => { sortField.value = sortMap[value] || 'shop_name'; searchShops() })
onMounted(() => void loadShops())
onBeforeUnmount(() => { listSerial++; shopSerial++; historySerial++; batchSerial++ })
</script>

<template>
  <section class="shop-panel">
    <header class="shop-toolbar">
      <div class="shop-summary">
        <span class="status-dot" :class="{loading: listLoading || syncLoading || updateLoading}" />
        <div><strong>商店管理</strong><span>{{ listLoading ? '正在刷新数据' : `共 ${total} 家商店` }}</span></div>
      </div>
      <label class="shop-search main-search"><svg viewBox="0 0 24 24" v-html="iconPath('search')"/><input v-model="shopSearch" autocomplete="off" placeholder="按商店名称搜索" @keyup.enter="searchShops"/><kbd v-if="total">{{ total }}</kbd></label>
      <button class="update-button" type="button" @click="openItemQuery()"><svg viewBox="0 0 24 24" v-html="iconPath('chart')"/><span>查物品价格</span></button>
      <button class="update-button" type="button" :disabled="syncLoading" @click="syncShops"><svg viewBox="0 0 24 24" v-html="iconPath('sync')"/><span>{{ syncLoading ? '同步中' : '同步目录' }}</span></button>
      <button class="refresh-button" :class="{syncing: listLoading}" :disabled="listLoading" type="button" aria-label="刷新商店列表" @click="loadShops(page)"><svg viewBox="0 0 24 24" v-html="iconPath('refresh')"/></button>
    </header>

    <section class="filter-strip">
      <label class="mini-filter"><span>店主</span><input v-model="playerSearch" autocomplete="off" @keyup.enter="searchShops"/></label>
      <label class="mini-filter"><span>物品</span><input v-model="itemSearchFilter" autocomplete="off" @keyup.enter="searchShops"/></label>
      <BaseSelect v-model="sellTypeFilter" :options="typeOptions" class="filter-select" />
      <BaseSelect v-model="sortDisplay" :options="sortOptions" class="filter-select" />
      <button class="sort-order" type="button" @click="toggleSortOrder">{{ sortOrder === 'asc' ? '升序' : '降序' }}</button>
      <TimeRangePicker v-model="updatedRange" class="range-filter" />
      <button class="filter-btn" type="button" @click="searchShops"><svg viewBox="0 0 24 24" v-html="iconPath('search')"/><span>筛选</span></button>
      <button class="filter-btn muted" type="button" @click="clearFilters"><svg viewBox="0 0 24 24" v-html="iconPath('sliders')"/><span>清空</span></button>
    </section>

    <div v-if="stats" class="stats-line">
      <span>记录 <strong>{{ stats.prices }}</strong></span><span>批次 <strong>{{ stats.batches }}</strong></span><span>出售 <strong>{{ stats.sell }}</strong></span><span>收购 <strong>{{ stats.buy }}</strong></span><span>最近扫描 <strong>{{ formatDate(stats.latest_update) }}</strong></span>
    </div>
    <div v-if="notice" class="notice-line">{{ notice }}</div>

    <div class="shop-scroll">
      <div v-if="listLoading && !listLoaded" class="shop-state loading-state"><span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span><strong>正在同步市场档案</strong><p>读取商店目录与最新批次索引</p></div>
      <div v-else-if="listError && !shops.length" class="shop-state"><span class="state-code">NO SIGNAL</span><strong>商店目录暂时不可用</strong><p>{{ listError }}</p><button type="button" @click="loadShops(1)">重新尝试</button></div>
      <div v-else-if="!shops.length" class="shop-state"><span class="state-code">NO MATCH</span><strong>没有匹配的商店</strong><p>调整筛选条件或先同步 shop_list 目录。</p></div>
      <div v-else class="shop-list">
        <article v-for="shop in shops" :key="shop.shop_name" class="shop-card">
          <button class="shop-card-main" type="button" @click="openShop(shop.shop_name)">
            <span class="card-status"><i :class="{inactive: !shop.new_batch_id}"/><span>{{ shop.new_batch_id ? '可用' : '无快照' }}</span></span>
            <span class="card-name"><svg viewBox="0 0 24 24" v-html="iconPath('store')"/><strong>{{ shop.shop_name }}</strong></span>
            <span class="card-meta"><time>扫描 {{ formatDate(shop.latest_update) }}</time><code>{{ shortBatch(shop.new_batch_id) }}</code></span>
            <span class="card-stats"><b>{{ shop.item_count }}</b><small>物品</small><b>{{ shop.price_count }}</b><small>记录</small><b>{{ shop.batch_count }}</b><small>批次</small></span>
            <span class="card-owner">{{ shop.players.slice(0, 3).join(', ') || '未知店主' }}{{ shop.players.length > 3 ? '...' : '' }}</span>
          </button>
          <footer class="card-admin-actions">
            <span>{{ shop.sell_count }} 出售 / {{ shop.buy_count }} 收购</span>
            <div>
              <button class="icon-btn" type="button" :disabled="updateLoading" @click="scanShop(shop.shop_name)"><BaseTooltip :text="updateShopName === shop.shop_name ? '正在扫描' : '扫描更新，扣 100 积分'"><svg viewBox="0 0 24 24" v-html="iconPath('refresh')"/></BaseTooltip></button>
              <button class="icon-btn danger" type="button" @click="openDeleteShop(shop)"><BaseTooltip text="删除整店"><svg viewBox="0 0 24 24" v-html="iconPath('trash')"/></BaseTooltip></button>
            </div>
          </footer>
        </article>
      </div>
    </div>

    <footer class="shop-footer">
      <span>第 {{ page }} / {{ totalPages }} 页</span>
      <div class="pager"><BaseSelect v-model="pageLimit" :options="pageLimitOptions" class="page-select" @update:model-value="loadShops(1)"/><button :disabled="!hasPrevious" type="button" @click="loadShops(page - 1)">‹</button><input v-model="pageInput" type="number" min="1" :max="totalPages" @keyup.enter="loadShops(Number(pageInput))"/><button :disabled="!hasNext" type="button" @click="loadShops(page + 1)">›</button></div>
    </footer>

    <BaseDialog :open="dialogOpen" :title="selectedShop || '商店详情'" size="large" @close="closeShop">
      <div class="shop-dialog">
        <div v-if="shopLoading" class="dialog-state"><span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span><strong>正在读取价格快照</strong><p>{{ selectedShop }}</p></div>
        <div v-else-if="shopError" class="dialog-state"><span class="state-code">NO SNAPSHOT</span><strong>无法读取商店价格</strong><p>{{ shopError }}</p><button type="button" @click="openShop(selectedShop)">重新尝试</button></div>
        <template v-else-if="snapshot">
          <div class="shop-workspace">
            <header class="workspace-head">
              <div class="snapshot-meta"><span>当前批次</span><strong>{{ formatDate(snapshot.create_at) }}</strong><code>{{ snapshot.batch_id }}</code></div>
              <dl><div><dt>物品</dt><dd>{{ snapshotStats.items }}</dd></div><div><dt>出售</dt><dd>{{ snapshotStats.sell }}</dd></div><div><dt>收购</dt><dd>{{ snapshotStats.buy }}</dd></div></dl>
              <div class="dialog-tabs"><button :class="{active: dialogTab === 'prices'}" type="button" @click="switchDialogTab('prices')">价格工作台</button><button :class="{active: dialogTab === 'batches'}" type="button" @click="switchDialogTab('batches')">批次历史</button></div>
            </header>

            <template v-if="dialogTab === 'prices'">
              <div class="workspace-controls"><label class="workspace-search"><svg viewBox="0 0 24 24" v-html="iconPath('search')"/><input v-model="itemSearch" autocomplete="off" placeholder="搜索物品、店主或坐标"/></label><BaseSelect v-model="typeFilter" :options="typeOptions" aria-label="价格类型"/></div>
              <div class="workspace-columns">
                <section class="item-index">
                  <header><strong>物品列表</strong><span>{{ filteredPriceGroups.length }} 项</span></header>
                  <div class="item-index-scroll">
                    <button v-for="group in filteredPriceGroups" :key="group.key" :class="{selected: selectedItem === group.item_id && selectedSellType === group.sell_type}" type="button" @click="selectGroup(group)">
                      <span class="item-icon-wrap"><img :src="itemIconOrPlaceholder(group.item_id)" alt="" class="item-icon" loading="lazy"/><span><strong>{{ group.item_id }}</strong><small>{{ group.entries.length }} 个价格</small></span></span>
                      <span><em :class="group.sell_type">{{ group.sell_type === 'sell' ? '出售' : '收购' }}</em><b>{{ groupPrice(group) }}</b></span>
                    </button>
                    <div v-if="!filteredPriceGroups.length" class="column-empty">没有匹配的物品</div>
                  </div>
                </section>
                <main class="detail-pane">
                  <div v-if="!selectedItem" class="detail-placeholder"><svg viewBox="0 0 24 24" v-html="iconPath('package')"/><strong>选择一个物品</strong><p>从左侧选择物品后，可查看当前批次报价、编辑价格或查询各商店价格。</p></div>
                  <template v-else>
                    <header class="detail-head">
                      <div class="detail-head-left"><img :src="itemIconOrPlaceholder(selectedItem)" alt="" class="item-icon detail-icon"/><div><span>{{ selectedSellType === 'sell' ? '出售价格' : '收购价格' }}</span><h3>{{ selectedItem }}</h3></div></div>
                      <div class="detail-actions"><button type="button" @click="openItemQuery(selectedItem)">查各店</button><button class="danger" type="button" :disabled="!selectedPriceGroup" @click="selectedPriceGroup && openDeleteItem(selectedPriceGroup)">删物品</button></div>
                      <div class="type-switch"><button v-for="type in (['sell', 'buy'] as ShopSellType[])" :key="type" :class="{active: selectedSellType === type}" type="button" @click="selectedSellType = type">{{ type === 'sell' ? '出售' : '收购' }}</button></div>
                    </header>
                    <section class="quote-section">
                      <header><strong>当前批次报价</strong><span>{{ selectedPriceGroup?.entries.length || 0 }} 条记录</span></header>
                      <div v-if="selectedPriceGroup" class="quote-grid">
                        <article v-for="entry in selectedPriceGroup.entries" :key="entry.id" class="quote-card">
                          <div class="quote-price"><img :src="itemIconOrPlaceholder(selectedItem)" alt="" class="item-icon quote-icon"/><strong>{{ formatPrice(entry.price) }}</strong><span>{{ entry.count || '数量未知' }}</span></div>
                          <div><span>店主</span><strong>{{ entry.player || '未知店主' }}</strong></div>
                          <div><span>坐标</span><strong>{{ entry.position || '位置未知' }}</strong></div>
                          <footer><button type="button" @click="openEditPrice(entry)"><svg viewBox="0 0 24 24" v-html="iconPath('edit')"/>改价</button><button class="danger" type="button" @click="openDeletePrice(entry)"><svg viewBox="0 0 24 24" v-html="iconPath('trash')"/>删除</button></footer>
                        </article>
                      </div>
                      <div v-else class="empty-inline">暂无{{ selectedSellType === 'sell' ? '出售' : '收购' }}报价</div>
                    </section>
                    <section class="history-section">
                      <header><strong>历史价格</strong><span>{{ selectedHistory.length }} 条记录</span></header>
                      <div v-if="historyLoading" class="history-state">正在加载历史价格</div>
                      <div v-else-if="historyError && !history.length" class="history-state error">{{ historyError }}</div>
                      <div v-else class="history-layout">
                        <div v-if="chartPoints" class="chart-wrap"><svg aria-label="价格历史折线图" class="history-chart" role="img" viewBox="0 0 600 170" preserveAspectRatio="none"><line x1="24" y1="22" x2="576" y2="22"/><line x1="24" y1="84" x2="576" y2="84"/><line x1="24" y1="146" x2="576" y2="146"/><polyline :points="chartPoints"/></svg><div class="chart-scale"><span>{{ formatPrice(chartMax) }}</span><span>{{ formatPrice(chartMin) }}</span></div></div>
                        <div v-else class="mini-empty">暂无可绘制的历史价格</div>
                        <div class="history-table"><table><thead><tr><th>时间</th><th>批次</th><th>价格</th><th>店主</th><th>坐标</th></tr></thead><tbody><tr v-for="entry in selectedHistory" :key="entry.id"><td>{{ formatDate(entry.create_at) }}</td><td>{{ shortBatch(entry.batch_id) }}</td><td>{{ formatPrice(entry.price) }}</td><td>{{ entry.player || '未知' }}</td><td>{{ entry.position || '未知' }}</td></tr></tbody></table></div>
                      </div>
                    </section>
                  </template>
                </main>
              </div>
            </template>

            <section v-else class="batch-panel">
              <div v-if="batchLoading" class="dialog-state compact">正在读取批次历史</div>
              <div v-else-if="batchError" class="dialog-state compact error">{{ batchError }}</div>
              <div v-else-if="!batches.length" class="dialog-state compact">暂无批次历史</div>
              <template v-else>
                <div class="batch-list">
                  <article v-for="batch in batches" :key="batch.batch_id" class="batch-row">
                    <button class="batch-main" type="button" @click="openBatchPrices(batch.batch_id)"><strong>{{ shortBatch(batch.batch_id) }}</strong><span>{{ formatDate(batch.create_at) }}</span></button>
                    <dl><div><dt>记录</dt><dd>{{ batch.record_count }}</dd></div><div><dt>物品</dt><dd>{{ batch.item_count }}</dd></div><div><dt>出售</dt><dd>{{ batch.sell_count }}</dd></div><div><dt>收购</dt><dd>{{ batch.buy_count }}</dd></div></dl>
                    <button class="icon-btn danger" type="button" @click="openDeleteBatch(batch)"><BaseTooltip text="删除批次"><svg viewBox="0 0 24 24" v-html="iconPath('trash')"/></BaseTooltip></button>
                  </article>
                </div>
                <footer class="batch-pager"><button :disabled="batchPage <= 1" type="button" @click="loadBatchHistory(batchPage - 1)">‹</button><span>{{ batchPage }} / {{ batchTotalPages }}</span><button :disabled="batchPage >= batchTotalPages" type="button" @click="loadBatchHistory(batchPage + 1)">›</button></footer>
              </template>
            </section>
          </div>
        </template>
      </div>
    </BaseDialog>

    <BaseDialog :open="itemQueryConfirmOpen" title="查询物品价格" @close="itemQueryConfirmOpen = false">
      <form class="query-confirm" @submit.prevent="queryItemPrices">
        <span class="query-icon"><svg viewBox="0 0 24 24" v-html="iconPath('chart')"/></span>
        <strong>查询物品在各商店的分别价格</strong>
        <label class="query-item-input"><span>查询物品</span><div><img :src="itemIconOrPlaceholder(itemQueryInput)" alt="" class="item-icon confirm-icon"/><input v-model="itemQueryInput" maxlength="256" autocomplete="off" autofocus placeholder="输入物品名称或 ID，如安山岩" @input="itemQueryError = ''"/></div><small v-if="itemQueryError">{{ itemQueryError }}</small></label>
        <div class="query-type"><span>查询类型</span><BaseSelect v-model="itemQueryType" :options="queryTypeOptions"/></div>
        <p>查询会读取各商店最新批次中的该物品报价，管理员查询不扣积分。</p>
        <div class="query-actions"><button type="button" @click="itemQueryConfirmOpen = false">取消</button><button :disabled="itemQueryLoading" type="submit">{{ itemQueryLoading ? '查询中...' : '确定查询' }}</button></div>
      </form>
    </BaseDialog>

    <BaseDialog :open="itemQueryOpen" title="各店价格报告" size="wide" @close="itemQueryOpen = false">
      <div class="item-report">
        <div v-if="itemQueryLoading && !itemQueryError" class="dialog-state"><span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span><strong>正在查询各商店{{ itemQueryType }}价格</strong><p>{{ itemQueryInput }}</p></div>
        <section v-else class="report-grid">
          <div class="report-pane">
            <header class="report-head"><div class="report-item"><img :src="itemIconOrPlaceholder(itemQueryName || itemQueryInput)" alt=""/><div><span>查询物品</span><strong>{{ itemQueryName || itemQueryInput }}</strong></div></div><div class="type-switch"><button v-for="type in queryTypeOptions" :key="type" :class="{active: itemQueryType === type}" type="button" @click="itemQueryType = type; queryItemPrices()">{{ type }}</button></div></header>
            <div v-if="itemQueryError" class="report-error"><span>查询失败</span><strong>无法获取{{ itemQueryType }}价格</strong><p>{{ itemQueryError }}</p></div>
            <template v-else-if="itemQueryResult.length">
              <div class="report-price"><span>各店{{ itemQueryType }}均价</span><strong>{{ formatPrice(itemQueryStats.average) }}</strong><small>按最新批次中的全部报价直接统计</small></div>
              <dl class="report-metrics"><div><dt>来源商店</dt><dd>{{ itemQueryStats.shops }}</dd></div><div><dt>报价记录</dt><dd>{{ itemQueryStats.records }}</dd></div><div><dt>最低价格</dt><dd>{{ formatPrice(itemQueryStats.min) }}</dd></div><div><dt>最高价格</dt><dd>{{ formatPrice(itemQueryStats.max) }}</dd></div></dl>
            </template>
            <div v-else class="report-empty"><strong>暂无可用报价</strong><span>当前最新商店批次中没有该物品的{{ itemQueryType }}价格。</span></div>
            <div class="report-ledger"><span>管理员查询</span><strong>不扣积分</strong><i/><span>匹配记录</span><strong>{{ itemQueryResult.length }}</strong></div>
          </div>
          <div class="report-sources">
            <header><div><strong>来源报价</strong><span>{{ itemQueryType }}价格</span></div><small>{{ itemQueryStats.shops }} 家商店</small></header>
            <div v-if="itemQueryResult.length" class="source-list detailed"><article v-for="entry in itemQueryResult" :key="entry.id"><div><strong>{{ entry.shop }}</strong><span>{{ entry.player || '未知店主' }}</span></div><b>{{ formatPrice(entry.price) }}</b><small>{{ entry.count || '数量未知' }} / {{ entry.position || '位置未知' }}</small><code>{{ shortBatch(entry.batch_id) }}</code></article></div>
            <div v-else class="source-empty">暂无来源商店</div>
          </div>
        </section>
      </div>
    </BaseDialog>
    <BaseDialog :open="syncResultOpen" :title="syncResultTitle" @close="syncResultOpen = false"><div class="sync-result" :class="{error: syncResultFailed}"><strong>{{ syncResultFailed ? '未完成同步' : '目录已更新' }}</strong><p>{{ syncResultMessage }}</p><div><button type="button" @click="syncResultOpen = false">知道了</button></div></div></BaseDialog>
    <BaseDialog :open="updateLoading" :title="`正在更新 ${updateShopName}`" @close="closeShopUpdateProgress"><div class="update-progress"><span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span><strong>正在扫描商店价格</strong><p>Bot 正在读取商店货架与报价，请勿关闭此页面。</p></div></BaseDialog>
    <BaseDialog :open="shopUpdateResultOpen" :title="shopUpdateResultTitle" @close="shopUpdateResultOpen = false"><div class="sync-result" :class="{error: shopUpdateResultFailed}"><strong>{{ shopUpdateResultFailed ? '未完成更新' : '价格档案已更新' }}</strong><p>{{ shopUpdateResultMessage }}</p><div><button type="button" @click="shopUpdateResultOpen = false">知道了</button></div></div></BaseDialog>
    <BaseDialog :open="deleteShopOpen" title="确认删除整店" @close="deleteShopOpen = false"><div class="confirm-box"><strong>{{ deleteShopTarget?.shop_name }}</strong><p>将删除该商店全部价格历史：{{ deleteShopTarget?.batch_count || 0 }} 个批次，{{ deleteShopTarget?.price_count || 0 }} 条记录。</p><small v-if="deleteShopError">{{ deleteShopError }}</small><div><button type="button" @click="deleteShopOpen = false">取消</button><button class="danger" :disabled="deleteShopLoading" type="button" @click="confirmDeleteShop">{{ deleteShopLoading ? '删除中...' : '确认删除' }}</button></div></div></BaseDialog>
    <BaseDialog :open="deleteBatchOpen" title="确认删除批次" @close="deleteBatchOpen = false"><div class="confirm-box"><strong>{{ shortBatch(deleteBatchTarget?.batch_id) }}</strong><p>将删除该批次的 {{ deleteBatchTarget?.record_count || 0 }} 条价格记录。</p><small v-if="deleteBatchError">{{ deleteBatchError }}</small><div><button type="button" @click="deleteBatchOpen = false">取消</button><button class="danger" :disabled="deleteBatchLoading" type="button" @click="confirmDeleteBatch">{{ deleteBatchLoading ? '删除中...' : '确认删除' }}</button></div></div></BaseDialog>
    <BaseDialog :open="editPriceOpen" title="修改价格" @close="editPriceOpen = false"><div class="confirm-box"><strong>{{ editPriceTarget?.item_id }}</strong><label class="price-edit"><span>新价格</span><input v-model="editPriceValue" type="number" min="0.01" step="0.01" @keyup.enter="confirmEditPrice"/></label><small v-if="editPriceError">{{ editPriceError }}</small><div><button type="button" @click="editPriceOpen = false">取消</button><button :disabled="editPriceLoading" type="button" @click="confirmEditPrice">{{ editPriceLoading ? '保存中...' : '保存' }}</button></div></div></BaseDialog>
    <BaseDialog :open="deletePriceOpen" title="确认删除价格" @close="deletePriceOpen = false"><div class="confirm-box"><strong>{{ deletePriceTarget?.item_id }} / {{ formatPrice(deletePriceTarget?.price) }}</strong><p>只删除当前批次中的这一条价格记录。</p><small v-if="deletePriceError">{{ deletePriceError }}</small><div><button type="button" @click="deletePriceOpen = false">取消</button><button class="danger" :disabled="deletePriceLoading" type="button" @click="confirmDeletePrice">{{ deletePriceLoading ? '删除中...' : '确认删除' }}</button></div></div></BaseDialog>
    <BaseDialog :open="deleteItemOpen" title="确认删除物品" @close="deleteItemOpen = false"><div class="confirm-box"><strong>{{ deleteItemTarget?.item_id }}</strong><p>将删除当前批次中该物品的 {{ deleteItemTarget?.sell_type === 'sell' ? '出售' : '收购' }} 价格，共 {{ deleteItemTarget?.entries.length || 0 }} 条记录。</p><small v-if="deleteItemError">{{ deleteItemError }}</small><div><button type="button" @click="deleteItemOpen = false">取消</button><button class="danger" :disabled="deleteItemLoading" type="button" @click="confirmDeleteItem">{{ deleteItemLoading ? '删除中...' : '确认删除' }}</button></div></div></BaseDialog>
  </section>
</template>

<style scoped>
.shop-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin-top: 10px; overflow: hidden; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 10px 28px color-mix(in srgb, var(--shadow) 28%, transparent); }
.shop-toolbar { display: grid; flex: 0 0 auto; grid-template-columns: minmax(150px, 1fr) minmax(220px, 420px) auto auto 36px; align-items: center; gap: 10px; min-height: 58px; padding: 10px 12px; background: color-mix(in srgb, var(--surface) 32%, var(--panel-bg)); border-bottom: 1px solid var(--border); }
.shop-summary { display: flex; align-items: center; gap: 9px; }.shop-summary div { display: grid; gap: 2px; }.shop-summary strong { font-size: 14px; }.shop-summary span { color: var(--muted-text); font-size: 11px; }
.status-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 3px var(--success-soft); }.status-dot.loading { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-soft); }
.shop-search { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; height: 36px; padding: 0 9px; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.shop-search:focus-within { color: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }.shop-search svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.shop-search input { min-width: 0; height: 100%; padding: 0 7px; color: var(--panel-text); background: transparent; border: 0; outline: none; font-size: 11px; }.shop-search kbd { padding: 2px 6px; color: var(--muted-text); background: var(--surface); border-radius: 3px; font-size: 11px; }
.refresh-button, .icon-btn { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.refresh-button:hover:not(:disabled), .icon-btn:hover:not(:disabled) { color: var(--accent); background: var(--surface-hover); border-color: var(--accent); }.refresh-button:disabled, .icon-btn:disabled { opacity: .5; }.refresh-button svg, .icon-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.refresh-button.syncing svg { animation: rotate .8s linear infinite; }.icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); }
.update-button, .filter-btn, .sort-order { display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 12px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-weight: 700; white-space: nowrap; }.update-button:hover:not(:disabled), .filter-btn:hover, .sort-order:hover { background: var(--surface-hover); border-color: var(--accent); }.update-button svg, .filter-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.filter-btn.muted { color: var(--muted-text); }
.filter-strip { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }.mini-filter { display: grid; grid-template-columns: auto minmax(90px, 140px); align-items: center; gap: 6px; height: 34px; padding: 0 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.mini-filter span { color: var(--muted-text); font-size: 11px; }.mini-filter input { min-width: 0; color: var(--panel-text); background: transparent; border: 0; outline: 0; font-size: 12px; }.filter-select { width: 92px; }.range-filter { min-width: 190px; }
.stats-line, .notice-line { display: flex; flex-wrap: wrap; gap: 14px; flex: 0 0 auto; padding: 9px 12px; color: var(--muted-text); border-bottom: 1px solid var(--border); font-size: 11px; }.stats-line strong { color: var(--panel-text); }.notice-line { color: var(--accent); }
.shop-scroll { flex: 1 1 auto; min-height: 0; padding: 0 12px 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }.shop-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; padding: 12px 0; }
.shop-card { display: grid; min-width: 0; overflow: hidden; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; transition: background-color .15s ease, border-color .15s ease; }.shop-card:hover { background: var(--surface-hover); border-color: var(--accent); }.shop-card-main { display: grid; grid-template-rows: auto auto auto auto auto; gap: 10px; width: 100%; padding: 14px; color: var(--panel-text); background: transparent; border: 0; text-align: left; cursor: pointer; }
.card-status { display: flex; align-items: center; gap: 6px; color: var(--muted-text); font-size: 11px; }.card-status i { width: 7px; height: 7px; background: var(--success); border-radius: 50%; }.card-status i.inactive { background: var(--muted-text); }.card-name { display: flex; align-items: center; gap: 9px; min-width: 0; }.card-name svg { flex: 0 0 auto; width: 18px; height: 18px; color: var(--muted-text); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }.card-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.card-meta, .card-owner { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted-text); font-size: 11px; }.card-meta code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: inherit; }.card-stats { display: grid; grid-template-columns: repeat(3, auto 1fr); gap: 2px 5px; align-items: baseline; padding-top: 4px; border-top: 1px solid var(--border); }.card-stats b { font-size: 15px; }.card-stats small { color: var(--muted-text); font-size: 10px; }
.card-admin-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 42px; padding: 6px 10px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 36%, transparent); border-top: 1px solid var(--border); font-size: 11px; }.card-admin-actions div { display: flex; gap: 6px; }.card-admin-actions .icon-btn { width: 28px; height: 28px; }
.shop-footer { display: flex; flex: 0 0 42px; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 0 12px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); border-top: 1px solid var(--border); font-size: 11px; }.pager { display: flex; align-items: center; gap: 6px; }.pager button { width: 28px; height: 28px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.pager button:disabled { opacity: .4; }.pager input { width: 48px; height: 28px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; text-align: center; }.page-select { width: 66px; }
.shop-state, .dialog-state { display: grid; place-content: center; justify-items: center; gap: 8px; width: 100%; height: 100%; min-height: 260px; color: var(--muted-text); text-align: center; }.dialog-state.compact { min-height: 180px; }.shop-state strong, .dialog-state strong { color: var(--panel-text); font-size: 13px; }.shop-state p, .dialog-state p { max-width: 320px; margin: 0; font-size: 12px; line-height: 1.5; }.shop-state button, .dialog-state button { margin-top: 5px; padding: 8px 12px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 12px; font-weight: 700; }.state-code { color: var(--accent); font-size: 11px; font-weight: 750; }
.market-loader { position: relative; display: flex; align-items: end; gap: 4px; width: 66px; height: 50px; padding: 11px 10px 9px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 5px; }.market-loader i { display: block; flex: 1; height: 13px; background: var(--accent); border-radius: 2px 2px 0 0; animation: market-bars .8s ease-in-out infinite alternate; }.market-loader i:nth-child(2) { height: 24px; animation-delay: -.27s; }.market-loader i:nth-child(3) { height: 18px; animation-delay: -.54s; }.market-loader b { position: absolute; right: 7px; bottom: 7px; left: 7px; height: 2px; background: var(--accent); animation: market-scan 1s ease-in-out infinite alternate; }
.shop-dialog { display: flex; flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; margin: -16px -18px -18px; background: var(--panel-bg); }.shop-workspace { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; width: 100%; }.workspace-head { display: grid; grid-template-columns: minmax(210px, 1fr) auto auto; align-items: center; gap: 16px; min-height: 72px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }.snapshot-meta { display: grid; min-width: 0; gap: 3px; }.snapshot-meta span { color: var(--muted-text); font-size: 11px; font-weight: 600; }.snapshot-meta strong { font-size: 13px; }.snapshot-meta code { overflow: hidden; color: var(--muted-text); text-overflow: ellipsis; white-space: nowrap; font-family: inherit; font-size: 11px; }.workspace-head dl { display: flex; gap: 16px; margin: 0; }.workspace-head dl div { display: flex; align-items: baseline; gap: 6px; }.workspace-head dt { color: var(--muted-text); font-size: 11px; }.workspace-head dd { margin: 0; font-size: 14px; font-weight: 700; }
.dialog-tabs, .type-switch { display: flex; padding: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.dialog-tabs button, .type-switch button { height: 30px; padding: 0 11px; color: var(--muted-text); background: transparent; border: 0; border-radius: 2px; font-size: 12px; }.dialog-tabs button.active, .type-switch button.active { color: var(--panel-text); background: var(--panel-bg); box-shadow: 0 1px 3px color-mix(in srgb, var(--shadow) 25%, transparent); font-weight: 700; }
.workspace-controls { display: grid; grid-template-columns: minmax(240px, 1fr) 120px; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); }.workspace-search { display: grid; grid-template-columns: 20px minmax(0,1fr); align-items: center; height: 40px; padding: 0 10px; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.workspace-search:focus-within { color: var(--accent); border-color: var(--accent); }.workspace-search svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.workspace-search input { min-width: 0; height: 100%; padding: 0 7px; color: var(--panel-text); background: transparent; border: 0; outline: none; font-size: 13px; }
.workspace-columns { display: grid; flex: 1 1 auto; grid-template-columns: minmax(260px, 30%) minmax(0, 1fr); min-width: 0; min-height: 0; }.item-index { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--border); }.item-index > header { display: flex; flex: 0 0 48px; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid var(--border); }.item-index > header strong { font-size: 13px; }.item-index > header span { color: var(--muted-text); font-size: 11px; }.item-index-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }.item-index-scroll > button { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 66px; padding: 10px 14px; color: var(--panel-text); background: transparent; border: 0; border-bottom: 1px solid var(--border); text-align: left; }.item-index-scroll > button:hover { background: var(--surface-hover); }.item-index-scroll > button.selected { background: var(--surface-selected); box-shadow: inset 3px 0 var(--accent); }.item-index-scroll > button > span:last-child { display: grid; min-width: 0; justify-items: end; gap: 5px; }
.item-icon-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }.item-icon-wrap > span { display: grid; min-width: 0; gap: 2px; }.item-icon { flex: 0 0 auto; width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated; border-radius: 3px; background: color-mix(in srgb, var(--surface) 60%, transparent); }.item-icon-wrap .item-icon { width: 28px; height: 28px; }.detail-icon { width: 36px; height: 36px; }.quote-icon { width: 28px; height: 28px; margin-bottom: 4px; }.item-index-scroll strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.item-index-scroll small { color: var(--muted-text); font-size: 11px; }.item-index-scroll em { padding: 3px 6px; border-radius: 3px; font-size: 11px; font-style: normal; font-weight: 700; }.item-index-scroll em.sell { color: var(--success-text); background: var(--success-soft); }.item-index-scroll em.buy { color: var(--warning-text); background: var(--warning-soft); }.item-index-scroll b { color: var(--panel-text); font-size: 12px; font-weight: 700; }.column-empty { display: grid; place-content: center; min-height: 160px; color: var(--muted-text); font-size: 12px; }
.detail-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }.detail-placeholder { display: grid; flex: 1; place-content: center; justify-items: center; gap: 8px; padding: 24px; color: var(--muted-text); text-align: center; }.detail-placeholder svg { width: 32px; height: 32px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }.detail-placeholder strong { color: var(--panel-text); font-size: 16px; }.detail-placeholder p { margin: 0; font-size: 12px; }.detail-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; min-height: 68px; padding: 10px 16px; border-bottom: 1px solid var(--border); }.detail-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }.detail-head span { color: var(--muted-text); font-size: 11px; }.detail-head h3 { margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; }.detail-actions { display: flex; gap: 6px; }.detail-actions button { height: 30px; padding: 0 10px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-weight: 700; }.detail-actions button.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
.quote-section { flex: 0 0 auto; max-height: 46%; overflow: hidden; border-bottom: 1px solid var(--border); }.quote-section > header, .history-section > header { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--border); }.quote-section > header strong, .history-section > header strong { font-size: 13px; }.quote-section > header span, .history-section > header span { color: var(--muted-text); font-size: 11px; }.quote-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); max-height: 250px; overflow-y: auto; }.quote-card { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 8px 14px; min-height: 112px; padding: 12px 16px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }.quote-card > div { display: grid; min-width: 0; gap: 4px; }.quote-card span { color: var(--muted-text); font-size: 11px; }.quote-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.quote-price { grid-row: span 2; align-content: center; }.quote-price strong { font-size: 20px !important; }.quote-card footer { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 6px; }.quote-card footer button { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; }.quote-card footer button.danger { color: var(--danger); }.quote-card footer svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.empty-inline { display: grid; place-content: center; min-height: 90px; color: var(--muted-text); font-size: 12px; }
.history-section { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }.history-layout { display: grid; flex: 1 1 auto; grid-template-columns: minmax(300px, 1fr) minmax(280px, .9fr); min-height: 0; }.chart-wrap { position: relative; display: grid; place-items: center; height: 100%; min-height: 200px; overflow: hidden; background: color-mix(in srgb, var(--surface) 42%, var(--panel-bg)); border-right: 1px solid var(--border); }.history-chart { display: block; width: 100%; height: 100%; min-height: 200px; }.history-chart line { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }.history-chart polyline { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }.chart-scale { position: absolute; inset: 10px 10px 10px auto; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }.chart-scale span { padding: 2px 5px; color: var(--muted-text); background: color-mix(in srgb, var(--panel-bg) 88%, transparent); border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 3px; font-size: 10px; }.history-table, .query-table { min-height: 0; overflow: auto; }.history-table table, .query-table table { width: 100%; border-collapse: collapse; }.history-table th, .query-table th { position: sticky; top: 0; padding: 10px 12px; color: var(--muted-text); background: var(--surface); border-bottom: 1px solid var(--border); text-align: left; font-size: 11px; }.history-table td, .query-table td { padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 11px; }.history-state, .mini-empty { display: grid; place-content: center; min-height: 160px; color: var(--muted-text); font-size: 12px; }.history-state.error { color: var(--danger); }
.batch-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: hidden; }.batch-list { display: grid; align-content: start; gap: 8px; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }.batch-row { display: grid; grid-template-columns: minmax(170px, 1fr) auto 38px; align-items: center; gap: 12px; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 5px; }.batch-main { display: grid; gap: 4px; min-width: 0; color: var(--panel-text); background: transparent; border: 0; text-align: left; }.batch-row span { color: var(--muted-text); font-size: 11px; }.batch-row dl { display: flex; gap: 14px; margin: 0; }.batch-row dl div { display: grid; justify-items: center; gap: 3px; }.batch-row dt { color: var(--muted-text); font-size: 10px; }.batch-row dd { margin: 0; font-size: 14px; font-weight: 750; }.batch-pager { display: flex; flex: 0 0 48px; justify-content: center; align-items: center; gap: 8px; min-height: 48px; padding: 8px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 30%, var(--panel-bg)); border-top: 1px solid var(--border); font-size: 12px; }.batch-pager button { width: 30px; height: 30px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.batch-pager button:disabled { opacity: .4; }
.confirm-box { display: grid; gap: 10px; color: var(--panel-text); }.confirm-box p { margin: 0; color: var(--muted-text); font-size: 13px; line-height: 1.6; }.confirm-box small { color: var(--danger); }.confirm-box > div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }.confirm-box button { min-width: 88px; height: 36px; padding: 0 14px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-weight: 700; }.confirm-box button.danger { color: white; background: var(--danger); border-color: var(--danger); }.confirm-box button:disabled { opacity: .5; }.price-edit { display: grid; gap: 6px; }.price-edit span { color: var(--muted-text); font-size: 11px; }.price-edit input { height: 36px; min-width: 0; padding: 0 10px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; outline: 0; }
.sync-result { display: grid; gap: 10px; }.sync-result strong { color: var(--success-text); font-size: 14px; }.sync-result.error strong { color: var(--danger); }.sync-result p { margin: 0; color: var(--muted-text); font-size: 13px; line-height: 1.65; }.sync-result > div { display: flex; justify-content: flex-end; }.sync-result button { height: 34px; padding: 0 12px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 12px; font-weight: 700; }
.update-progress { display: grid; justify-items: center; gap: 10px; padding: 8px 0; text-align: center; }.update-progress .market-loader { margin-bottom: 2px; }.update-progress strong { font-size: 14px; }.update-progress p { max-width: 290px; margin: 0; color: var(--muted-text); font-size: 12px; line-height: 1.6; }
.query-confirm { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 14px 12px; width: min(430px, 100%); color: var(--panel-text); }.query-icon { display: grid; place-items: center; width: 36px; height: 36px; color: var(--accent-contrast); background: var(--accent); border-radius: 50%; }.query-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.query-confirm > strong { display: flex; align-items: center; min-height: 36px; font-size: 14px; line-height: 1.4; }.query-item-input { grid-column: 1 / -1; display: grid; gap: 6px; }.query-item-input > span, .query-type > span { color: var(--muted-text); font-size: 12px; }.query-item-input > div { display: grid; grid-template-columns: 32px minmax(0,1fr); align-items: center; gap: 8px; min-height: 46px; padding: 5px 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.query-item-input:focus-within > div { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }.query-item-input input { min-width: 0; width: 100%; height: 34px; color: var(--panel-text); background: transparent; border: 0; outline: 0; font-size: 13px; }.query-item-input small { color: var(--danger); font-size: 11px; }.confirm-icon { width: 24px; height: 24px; }.query-type { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.query-confirm > p { grid-column: 1 / -1; margin: 0; padding: 11px 12px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 58%, transparent); border-left: 3px solid var(--accent); font-size: 12px; line-height: 1.65; }.query-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }.query-actions button { min-width: 88px; height: 36px; padding: 0 14px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-weight: 700; }.query-actions button[type="submit"] { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }.query-actions button:disabled { opacity: .5; }
.item-report { display: grid; min-height: 390px; margin: -16px -18px -18px; }.report-grid { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(0, 1.1fr); min-height: 390px; color: var(--panel-text); }.report-pane { display: flex; flex-direction: column; min-width: 0; background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); border-right: 1px solid var(--border); }.report-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 10px 18px; border-bottom: 1px solid var(--border); }.report-item { display: flex; align-items: center; min-width: 0; gap: 10px; }.report-item img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }.report-item div { display: grid; min-width: 0; gap: 2px; }.report-item span { color: var(--muted-text); font-size: 10px; }.report-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }.report-price { display: grid; flex: 1 1 auto; align-content: center; justify-items: start; gap: 6px; min-height: 180px; padding: 28px; border-bottom: 1px solid var(--border); }.report-price span { color: var(--muted-text); font-size: 12px; }.report-price strong { color: var(--accent); font-size: 38px; font-weight: 780; line-height: 1.15; }.report-price small { color: var(--muted-text); font-size: 10px; }.report-metrics { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; }.report-metrics div { display: grid; align-content: center; justify-items: center; gap: 8px; padding: 12px 8px; border-right: 1px solid var(--border); }.report-metrics div:last-child { border-right: 0; }.report-metrics dt { color: var(--muted-text); font-size: 10px; white-space: nowrap; }.report-metrics dd { margin: 0; font-size: 18px; font-weight: 750; }.report-empty, .report-error { display: grid; flex: 1; place-content: center; justify-items: center; gap: 6px; min-height: 240px; padding: 40px 20px; text-align: center; }.report-empty span, .report-error p { color: var(--muted-text); font-size: 11px; line-height: 1.6; }.report-error > span { color: var(--danger); font-size: 10px; font-weight: 750; }.report-ledger { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 18px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 55%, var(--panel-bg)); border-top: 1px solid var(--border); font-size: 11px; }.report-ledger strong { color: var(--panel-text); }.report-ledger i { flex: 1; height: 1px; background: var(--border); }.report-sources { display: flex; flex-direction: column; min-width: 0; min-height: 0; }.report-sources > header { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 8px 18px; border-bottom: 1px solid var(--border); }.report-sources > header div { display: grid; gap: 2px; }.report-sources > header strong { font-size: 13px; }.report-sources > header span, .report-sources > header small { color: var(--muted-text); font-size: 10px; }.source-list.detailed { display: grid; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }.source-list.detailed article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; min-height: 70px; padding: 12px 14px; border-bottom: 1px solid var(--border); }.source-list.detailed article > div { display: grid; min-width: 0; gap: 3px; }.source-list.detailed strong, .source-list.detailed code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.source-list.detailed span, .source-list.detailed small, .source-list.detailed code { color: var(--muted-text); font-size: 10px; }.source-list.detailed b { color: var(--accent); font-size: 16px; }.source-empty { display: grid; place-content: center; min-height: 80px; color: var(--muted-text); font-size: 11px; }
.item-report { height: min(640px, calc(100dvh - 86px)); min-height: 0; overflow: hidden; }.report-grid { height: 100%; min-height: 0; overflow: hidden; }.report-pane, .report-sources { min-height: 0; overflow: hidden; }.report-sources { display: flex; flex-direction: column; }.source-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }.source-empty { flex: 1 1 auto; }
@keyframes rotate { to { transform: rotate(360deg); } }@keyframes market-bars { from { opacity: .38; transform: scaleY(.5); transform-origin: bottom; } to { opacity: 1; transform: scaleY(1); transform-origin: bottom; } }@keyframes market-scan { from { transform: translateX(-35%); } to { transform: translateX(35%); } }
@media (max-width: 760px) { .shop-toolbar { grid-template-columns: minmax(0,1fr) auto 36px; }.shop-summary { grid-column: 1 / -1; }.main-search { grid-column: 1 / -1; }.filter-strip { align-items: stretch; }.mini-filter, .filter-select, .range-filter, .filter-btn, .sort-order { flex: 1 1 150px; }.shop-list { grid-template-columns: 1fr; }.shop-dialog { display: block; min-height: 0; margin: 0; }.workspace-head { grid-template-columns: 1fr; gap: 10px; }.workspace-head dl { justify-content: space-between; }.workspace-controls { grid-template-columns: 1fr; }.workspace-columns { display: block; }.item-index { height: min(38dvh, 320px); min-height: 240px; border-right: 0; border-bottom: 1px solid var(--border); }.detail-head { grid-template-columns: 1fr; }.detail-pane { min-height: 0; overflow: visible; }.quote-section { max-height: none; }.history-layout, .report-grid { grid-template-columns: 1fr; }.chart-wrap { height: 200px; border-right: 0; border-bottom: 1px solid var(--border); }.batch-row { grid-template-columns: 1fr 38px; }.batch-row dl { grid-column: 1 / -1; justify-content: space-between; }.report-pane { border-right: 0; border-bottom: 1px solid var(--border); }.report-price { justify-items: center; min-height: 124px; padding: 20px 16px; text-align: center; }.report-price strong { font-size: 32px; }.report-sources { min-height: 220px; }.item-report, .report-grid { height: auto; overflow: visible; }.report-pane, .report-sources { overflow: visible; }.source-list { flex: initial; max-height: 320px; } }
@media (max-width: 480px) { .shop-scroll { padding-inline: 8px; }.shop-toolbar, .filter-strip { padding: 8px; }.update-button { width: 36px; padding: 0; justify-content: center; }.update-button span { display: none; }.shop-footer { align-items: stretch; flex-direction: column; height: auto; padding-block: 8px; }.pager { width: 100%; justify-content: space-between; }.quote-grid { grid-template-columns: 1fr; }.quote-card { grid-template-columns: 88px minmax(0,1fr); padding-inline: 12px; }.type-switch { width: 100%; }.type-switch button { flex: 1; } }
@media (prefers-reduced-motion: reduce) { .refresh-button.syncing svg, .market-loader i, .market-loader b { animation: none; } }
</style>
