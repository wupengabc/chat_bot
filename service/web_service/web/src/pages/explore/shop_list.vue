<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'
import BaseDialog from '../../components/BaseDialog.vue'
import BaseSelect from '../../components/BaseSelect.vue'
import ShopAverageReport from '../../components/ShopAverageReport.vue'
import {
  shopAverageRequest,
  shopInfoRequest,
  shopItemHistoryRequest,
  shopListRequest,
  shopUpdateDownload,
  type ShopAverageResponse,
  type ShopListItem,
  type ShopPrice,
  type ShopPriceHistoryEntry,
  type ShopSellType,
  type ShopSnapshot,
} from '../../utils/shop'
import {getItemIcon, getItemName} from '../../utils/itemIcon'

const typeOptions = ['全部类型', '出售', '收购']
const shops = ref<ShopListItem[]>([])
const listLoading = ref(false)
const listLoaded = ref(false)
const listError = ref('')
const shopSearch = ref('')
const dialogOpen = ref(false)
const selectedShop = ref('')
const snapshot = ref<ShopSnapshot | null>(null)
const shopLoading = ref(false)
const shopError = ref('')
const itemSearch = ref('')
const typeFilter = ref('全部类型')
const selectedItem = ref('')
const selectedSellType = ref<ShopSellType>('sell')
const history = ref<ShopPriceHistoryEntry[]>([])
const historyLoading = ref(false)
const historyError = ref('')
const confirmOpen = ref(false)
const confirmSellType = ref<ShopSellType>('sell')
const pendingItemName = ref('')
const confirmError = ref('')
const avgDialogOpen = ref(false)
const avgSellType = ref<ShopSellType>('sell')
const avgSellData = ref<ShopAverageResponse | null>(null)
const avgBuyData = ref<ShopAverageResponse | null>(null)
const avgLoading = ref(false)
const avgError = ref('')
const iconCache = ref<Record<string, string>>({})
const updateDialogOpen = ref(false)
const updateShopName = ref('')
const updateLoading = ref(false)
const updateError = ref('')
let listSerial = 0
let shopSerial = 0
let historySerial = 0
let avgSerial = 0

interface ShopPriceGroup {
  key: string
  item_id: string
  sell_type: ShopSellType
  entries: ShopPrice[]
}

const filteredShops = computed(() => {
  const query = shopSearch.value.trim().toLocaleLowerCase()
  return query ? shops.value.filter(shop => shop.shopname.toLocaleLowerCase().includes(query)) : shops.value
})

const filteredPriceGroups = computed<ShopPriceGroup[]>(() => {
  const query = itemSearch.value.trim().toLocaleLowerCase()
  const sellType = typeFilter.value === '出售' ? 'sell' : typeFilter.value === '收购' ? 'buy' : ''
  const filtered = (snapshot.value?.prices || []).filter(price => {
    return (!query || price.item_id.toLocaleLowerCase().includes(query) || price.player?.toLocaleLowerCase().includes(query) || price.position?.toLocaleLowerCase().includes(query))
      && (!sellType || price.sell_type === sellType)
  })
  const groups = new Map<string, ShopPriceGroup>()
  for (const price of filtered) {
    const key = `${price.item_id.toLocaleLowerCase()}\u0000${price.sell_type}`
    const group = groups.get(key)
    if (group) group.entries.push(price)
    else groups.set(key, {key, item_id: price.item_id, sell_type: price.sell_type, entries: [price]})
  }
  return Array.from(groups.values()).sort((a, b) => a.item_id.localeCompare(b.item_id, 'zh-CN'))
})

const snapshotStats = computed(() => {
  const prices = snapshot.value?.prices || []
  return {
    items: new Set(prices.map(price => price.item_id.toLocaleLowerCase())).size,
    sell: prices.filter(price => price.sell_type === 'sell').length,
    buy: prices.filter(price => price.sell_type === 'buy').length,
  }
})

const selectedPriceGroup = computed<ShopPriceGroup | null>(() => {
  if (!selectedItem.value) return null
  const entries = (snapshot.value?.prices || []).filter(price => {
    return price.item_id === selectedItem.value && price.sell_type === selectedSellType.value
  })
  return entries.length ? {
    key: `${selectedItem.value.toLocaleLowerCase()}\u0000${selectedSellType.value}`,
    item_id: selectedItem.value,
    sell_type: selectedSellType.value,
    entries,
  } : null
})

const selectedHistory = computed(() => history.value.filter(entry => entry.sell_type === selectedSellType.value))
const chartEntries = computed(() => selectedHistory.value.slice(0, 40).reverse())
const chartPoints = computed(() => {
  const entries = chartEntries.value
  if (!entries.length) return ''
  const values = entries.map(entry => Number(entry.price)).filter(Number.isFinite)
  if (!values.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return values.map((value, index) => {
    const x = values.length === 1 ? 300 : 24 + index * 552 / (values.length - 1)
    const y = span === 0 ? 82 : 146 - (value - min) * 124 / span
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})
const chartMin = computed(() => chartEntries.value.length ? Math.min(...chartEntries.value.map(entry => entry.price)) : null)
const chartMax = computed(() => chartEntries.value.length ? Math.max(...chartEntries.value.map(entry => entry.price)) : null)
const activeAvgData = computed(() => avgSellType.value === 'sell' ? avgSellData.value : avgBuyData.value)

function iconPath(name: 'store' | 'refresh' | 'search' | 'chart' | 'arrow' | 'package') {
  const icons = {
    store: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    chart: '<path d="M12 16v5m4-6.361V21m4-10.344V21m2-18-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15m2 3.463V21m4-6.344V21"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    package: '<path d="M12 22V12m8.27 6.27L22 20m-1-9.502V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.729l7 4a2 2 0 0 0 2 .001l.98-.559"/><path d="M3.29 7 12 12l8.71-5M7.5 4.27l8.997 5.148"/><circle cx="18.5" cy="16.5" r="2.5"/>',
  }
  return icons[name]
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

async function loadIcons(items: string[]) {
  const unique = [...new Set(items.map(item => item.trim().toLowerCase()))]
  const entries = await Promise.all(unique.map(async item => [item, await getItemIcon(item)] as const))
  iconCache.value = Object.fromEntries(entries)
}

function itemIcon(itemId: string): string {
  return iconCache.value[itemId.trim().toLowerCase()] || ''
}

function itemIconOrPlaceholder(itemId: string): string {
  return itemIcon(itemId) || `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`
  )}`
}

function formatPrice(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})
    : '—'
}

function avgTypeLabel(type: ShopSellType): string {
  return type === 'sell' ? '出售' : '收购'
}

function groupPrice(group: ShopPriceGroup) {
  const prices = group.entries.map(entry => entry.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? formatPrice(min) : `${formatPrice(min)} - ${formatPrice(max)}`
}

function shortBatch(value: string | null) {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : 'NO BATCH'
}

function selectGroup(group: ShopPriceGroup) {
  const first = group.entries[0]
  if (first) void selectItem(first)
}

async function loadShops() {
  const serial = ++listSerial
  listLoading.value = true
  listError.value = ''
  try {
    const result = await shopListRequest()
    if (serial !== listSerial) return
    shops.value = Array.isArray(result.shops) ? result.shops : []
    listLoaded.value = true
  } catch (requestError) {
    if (serial !== listSerial) return
    listError.value = requestError instanceof Error ? requestError.message : '商店列表加载失败'
  } finally {
    if (serial === listSerial) listLoading.value = false
  }
}

async function openShop(name: string) {
  const serial = ++shopSerial
  historySerial++
  avgSerial++
  selectedShop.value = name
  snapshot.value = null
  shopError.value = ''
  itemSearch.value = ''
  typeFilter.value = '全部类型'
  selectedItem.value = ''
  history.value = []
  historyError.value = ''
  dialogOpen.value = true
  shopLoading.value = true
  try {
    const result = await shopInfoRequest(name)
    if (serial !== shopSerial) return
    snapshot.value = result.shop
    void loadIcons(result.shop.prices.map(price => price.item_id))
  } catch (requestError) {
    if (serial !== shopSerial) return
    shopError.value = requestError instanceof Error ? requestError.message : '商店价格加载失败'
  } finally {
    if (serial === shopSerial) shopLoading.value = false
  }
}

function closeShop() {
  shopSerial++
  historySerial++
  avgSerial++
  dialogOpen.value = false
}

async function selectItem(price: ShopPrice) {
  if (historyLoading.value) return
  const serial = ++historySerial
  avgSerial++
  selectedItem.value = price.item_id
  selectedSellType.value = price.sell_type
  history.value = []
  historyError.value = ''
  historyLoading.value = true
  try {
    const result = await shopItemHistoryRequest(price.item_id, selectedShop.value)
    if (serial !== historySerial) return
    history.value = Array.isArray(result.history) ? result.history : []
  } catch (requestError) {
    if (serial !== historySerial) return
    historyError.value = requestError instanceof Error ? requestError.message : '历史价格加载失败'
  } finally {
    if (serial === historySerial) historyLoading.value = false
  }
}

function openConfirm(itemName: string, sellType: ShopSellType) {
  pendingItemName.value = itemName.trim()
  confirmSellType.value = sellType
  confirmError.value = ''
  confirmOpen.value = true
  if (pendingItemName.value) void loadIcons([pendingItemName.value])
}

function openCustomConfirm() {
  pendingItemName.value = ''
  confirmSellType.value = 'sell'
  confirmError.value = ''
  confirmOpen.value = true
}

function onPendingItemInput() {
  confirmError.value = ''
  const name = pendingItemName.value.trim()
  if (name) void loadIcons([name])
}

function confirmAverage() {
  const itemName = pendingItemName.value.trim()
  if (!itemName) {
    confirmError.value = '请输入要查询的物品名称或物品 ID'
    return
  }
  confirmOpen.value = false
  void loadIcons([itemName])
  void fetchAverage(itemName, confirmSellType.value)
}

function cancelAverage() {
  confirmOpen.value = false
  confirmError.value = ''
}

async function fetchAverage(itemId: string, type: ShopSellType) {
  const serial = ++avgSerial
  avgError.value = ''
  avgSellData.value = null
  avgBuyData.value = null
  avgSellType.value = type
  avgDialogOpen.value = true
  await doFetchAverage(itemId, type, serial)
}

async function doFetchAverage(itemId: string, type: ShopSellType, serial: number) {
  avgLoading.value = true
  try {
    const result = await shopAverageRequest(itemId, type)
    if (serial !== avgSerial) return
    if (type === 'sell') avgSellData.value = result
    else avgBuyData.value = result
  } catch (requestError) {
    if (serial !== avgSerial) return
    avgError.value = requestError instanceof Error ? requestError.message : '均价查询失败'
  } finally {
    if (serial === avgSerial) avgLoading.value = false
  }
}

function switchAvgType(type: ShopSellType) {
  if (avgSellType.value === type) return
  avgSellType.value = type
  avgError.value = ''
  const data = type === 'sell' ? avgSellData.value : avgBuyData.value
  if (!data && pendingItemName.value) {
    void doFetchAverage(pendingItemName.value, type, avgSerial)
  }
}

function openUpdateDialog() {
  updateShopName.value = ''
  updateError.value = ''
  updateLoading.value = false
  updateDialogOpen.value = true
}

function cancelUpdate() {
  if (updateLoading.value) return
  updateDialogOpen.value = false
  updateError.value = ''
  updateLoading.value = false
}

async function confirmUpdate() {
  const name = updateShopName.value.trim()
  if (!name) {
    updateError.value = '请输入商店名称'
    return
  }
  updateLoading.value = true
  updateError.value = ''
  try {
    const blob = await shopUpdateDownload(name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}_商店价格.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    updateDialogOpen.value = false
    void loadShops()
  } catch (requestError) {
    updateError.value = requestError instanceof Error ? requestError.message : '更新商店数据失败'
  } finally {
    updateLoading.value = false
  }
}

onMounted(() => void loadShops())
onBeforeUnmount(() => {
  listSerial++
  shopSerial++
  historySerial++
  avgSerial++
})
</script>

<template>
  <section class="shop-panel">
    <header class="shop-toolbar">
      <div class="shop-summary">
        <span class="status-dot" :class="{loading: listLoading}"/>
        <div><strong>商店目录</strong><span>{{ listLoading ? '正在刷新数据' : `共 ${shops.length} 家商店` }}</span></div>
      </div>
      <label class="shop-search">
        <span class="sr-only">搜索商店</span>
        <svg viewBox="0 0 24 24" v-html="iconPath('search')"/>
        <input v-model="shopSearch" autocomplete="off" placeholder="按商店名称搜索"/>
        <kbd v-if="shopSearch">{{ filteredShops.length }}</kbd>
      </label>
      <button class="custom-avg-button" type="button" @click="openCustomConfirm"><svg viewBox="0 0 24 24" v-html="iconPath('chart')"/><span>查询均价</span></button>
      <button class="update-button" type="button" :disabled="updateLoading" @click="openUpdateDialog"><svg viewBox="0 0 24 24" v-html="iconPath('refresh')"/><span>更新商店</span></button>
      <button class="refresh-button" :class="{syncing: listLoading}" :disabled="listLoading" type="button" aria-label="刷新商店列表" @click="loadShops">
        <svg viewBox="0 0 24 24" v-html="iconPath('refresh')"/>
      </button>
    </header>

    <div class="shop-scroll">
      <div v-if="listLoading && !listLoaded" class="shop-state loading-state">
        <span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span>
        <strong>正在同步市场档案</strong><p>读取商店目录与最新批次索引</p>
      </div>
      <div v-else-if="listError && !shops.length" class="shop-state">
        <span class="state-code">NO SIGNAL</span><strong>商店目录暂时不可用</strong><p>{{ listError }}</p>
        <button type="button" @click="loadShops">重新尝试</button>
      </div>
      <div v-else-if="!filteredShops.length" class="shop-state">
        <span class="state-code">NO MATCH</span><strong>{{ shops.length ? '没有匹配的商店' : '暂无商店档案' }}</strong><p>{{ shops.length ? '尝试缩短关键词或检查商店名称。' : '价格插件尚未同步任何商店。' }}</p>
      </div>
      <div v-else class="shop-list">
        <button v-for="shop in filteredShops" :key="shop.id" class="shop-card" type="button" @click="openShop(shop.shopname)">
          <span class="card-status"><i :class="{inactive: !shop.new_batch_id}"/><span>{{ shop.new_batch_id ? '可用' : '无快照' }}</span></span>
          <span class="card-name"><svg viewBox="0 0 24 24" v-html="iconPath('store')"/><strong>{{ shop.shopname }}</strong></span>
          <span class="card-meta"><time>建档 {{ formatDate(shop.create_at) }}</time><code>{{ shortBatch(shop.new_batch_id) }}</code></span>
          <span class="card-action">查看<svg viewBox="0 0 24 24" v-html="iconPath('arrow')"/></span>
        </button>
      </div>
    </div>

    <footer class="shop-footer"><span>显示 {{ filteredShops.length }} 家商店</span><span>{{ listError || '数据来自最新商店快照索引' }}</span></footer>

    <BaseDialog :open="dialogOpen" :title="selectedShop || '商店详情'" size="large" @close="closeShop">
      <div class="shop-dialog">
        <div v-if="shopLoading" class="dialog-state"><span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span><strong>正在读取价格快照</strong><p>{{ selectedShop }}</p></div>
        <div v-else-if="shopError" class="dialog-state"><span class="state-code">NO SNAPSHOT</span><strong>无法读取商店价格</strong><p>{{ shopError }}</p><button type="button" @click="openShop(selectedShop)">重新尝试</button></div>
        <template v-else-if="snapshot">
          <div class="shop-workspace">
            <header class="workspace-head">
              <div class="snapshot-meta"><span>最新快照</span><strong>{{ formatDate(snapshot.create_at) }}</strong><code>{{ snapshot.batch_id }}</code></div>
              <dl><div><dt>物品</dt><dd>{{ snapshotStats.items }}</dd></div><div><dt>出售</dt><dd>{{ snapshotStats.sell }}</dd></div><div><dt>收购</dt><dd>{{ snapshotStats.buy }}</dd></div></dl>
              <label class="workspace-search"><svg viewBox="0 0 24 24" v-html="iconPath('search')"/><input v-model="itemSearch" autocomplete="off" placeholder="搜索物品、店主或坐标"/></label>
              <BaseSelect v-model="typeFilter" :options="typeOptions" aria-label="价格类型"/>
            </header>

            <div class="workspace-columns">
              <section class="item-index">
                <header><strong>物品列表</strong><span>{{ filteredPriceGroups.length }} 项</span></header>
                <div class="item-index-scroll">
                  <button v-for="group in filteredPriceGroups" :key="group.key" :class="{selected: selectedItem === group.item_id && selectedSellType === group.sell_type}" type="button" @click="selectGroup(group)">
                      <span class="item-icon-wrap"><img :src="itemIconOrPlaceholder(group.item_id)" alt="" class="item-icon" loading="lazy"/><strong :title="group.item_id">{{ group.item_id }}</strong><small>{{ group.entries.length }} 个坐标</small></span>
                    <span><em :class="group.sell_type">{{ group.sell_type === 'sell' ? '出售' : '收购' }}</em><b>{{ groupPrice(group) }}</b></span>
                  </button>
                  <div v-if="!filteredPriceGroups.length" class="column-empty">没有匹配的物品</div>
                </div>
              </section>

              <main class="detail-pane">
                <div v-if="!selectedItem" class="detail-placeholder"><svg viewBox="0 0 24 24" v-html="iconPath('package')"/><strong>选择一个物品</strong><p>从左侧选择物品后，可查看当前报价和历史价格。</p></div>
                <template v-else>
                  <header class="detail-head"><div class="detail-head-left"><img :src="itemIconOrPlaceholder(selectedItem)" alt="" class="item-icon detail-icon"/><div><span>{{ selectedSellType === 'sell' ? '出售价格' : '收购价格' }}</span><h3>{{ selectedItem }}</h3></div></div><div class="detail-actions"><div class="type-switch"><button v-for="type in (['sell', 'buy'] as ShopSellType[])" :key="type" :class="{active: selectedSellType === type}" type="button" @click="selectedSellType = type">{{ type === 'sell' ? '出售' : '收购' }}</button></div><button class="avg-button" type="button" :disabled="avgLoading" @click="openConfirm(selectedItem, selectedSellType)">查询均价 <small>10 积分</small></button></div></header>
                  <section class="quote-section">
                    <header><strong>当前报价</strong><span>{{ selectedPriceGroup?.entries.length || 0 }} 个坐标</span></header>
                    <div v-if="selectedPriceGroup" class="quote-grid">
                      <article v-for="entry in selectedPriceGroup.entries" :key="entry.id" class="quote-card">
                        <div class="quote-price"><img :src="itemIconOrPlaceholder(selectedItem)" alt="" class="item-icon quote-icon"/><strong>{{ formatPrice(entry.price) }}</strong><span>{{ entry.count || '数量未知' }}</span></div>
                        <div><span>店主</span><strong>{{ entry.player || '未知店主' }}</strong></div>
                        <div><span>坐标</span><strong>{{ entry.position || '位置未知' }}</strong></div>
                      </article>
                    </div>
                    <div v-else class="empty-inline">暂无{{ selectedSellType === 'sell' ? '出售' : '收购' }}报价</div>
                  </section>
                  <section class="history-section">
                    <header><strong>历史价格</strong><span>{{ selectedHistory.length }} 条记录</span></header>
                    <div v-if="historyLoading" class="history-state"><span class="mini-spinner"/>正在加载历史价格</div>
                    <div v-else-if="historyError && !history.length" class="history-state error">{{ historyError }}</div>
                    <div v-else class="history-layout">
                      <div v-if="chartEntries.length === 1" class="chart-single"><span>单次价格快照</span><strong>{{ formatPrice(chartEntries[0]?.price) }}</strong><time>{{ formatDate(chartEntries[0]?.create_at || '') }}</time></div>
                      <div v-else-if="chartPoints" class="chart-wrap"><svg aria-label="价格历史折线图" class="history-chart" role="img" viewBox="0 0 600 170" preserveAspectRatio="none"><line x1="24" y1="22" x2="576" y2="22"/><line x1="24" y1="84" x2="576" y2="84"/><line x1="24" y1="146" x2="576" y2="146"/><polyline :points="chartPoints"/></svg><div class="chart-scale"><span>{{ formatPrice(chartMax) }}</span><span>{{ formatPrice(chartMin) }}</span></div></div>
                      <div v-else class="mini-empty">暂无历史价格</div>
                      <div class="history-table"><table><thead><tr><th>时间</th><th>价格</th><th>数量</th></tr></thead><tbody><tr v-for="entry in selectedHistory" :key="entry.id"><td>{{ formatDate(entry.create_at) }}</td><td><strong>{{ formatPrice(entry.price) }}</strong></td><td>{{ entry.count || '—' }}</td></tr></tbody></table></div>
                    </div>
                  </section>
                </template>
              </main>
            </div>
          </div>
        </template>
      </div>
    </BaseDialog>

    <BaseDialog :open="confirmOpen" title="查询全服均价" @close="cancelAverage">
      <form class="confirm-charge" @submit.prevent="confirmAverage">
        <span class="charge-icon">!</span>
        <strong>查询全服均价将扣除 10 积分</strong>
        <label class="confirm-item-input"><span>查询物品</span><div><img :src="itemIconOrPlaceholder(pendingItemName)" alt="" class="item-icon confirm-icon"/><input v-model="pendingItemName" maxlength="256" autocomplete="off" autofocus placeholder="输入物品名称或 ID，如安山岩" @input="onPendingItemInput"/></div><small v-if="confirmError">{{ confirmError }}</small></label>
        <div class="confirm-type"><span>查询类型</span><div class="type-switch"><button v-for="type in (['sell', 'buy'] as ShopSellType[])" :key="type" :class="{active: confirmSellType === type}" type="button" @click="confirmSellType = type">{{ type === 'sell' ? '出售' : '收购' }}</button></div></div>
        <p>确定后将调用全服价格数据库，按 IQR 规则计算该物品在当前所有商店中的{{ confirmSellType === 'sell' ? '出售' : '收购' }}均价。每次查询消耗 10 积分。</p>
        <div class="confirm-actions">
          <button type="button" class="confirm-cancel" @click="cancelAverage">取消</button>
          <button type="submit" class="confirm-ok" :disabled="avgLoading">{{ avgLoading ? '查询中…' : '确定查询' }}</button>
        </div>
      </form>
    </BaseDialog>

    <BaseDialog :open="avgDialogOpen" title="全服均价报告" size="wide" @close="avgDialogOpen = false">
      <div class="avg-dialog">
        <div v-if="avgLoading && !avgError" class="dialog-state"><span class="market-loader" aria-hidden="true"><i/><i/><i/><b/></span><strong>正在查询全服{{ avgTypeLabel(avgSellType) }}均价</strong><p>{{ pendingItemName }}</p></div>
        <ShopAverageReport v-else-if="avgError || avgSellData || avgBuyData" :data="activeAvgData" :error="avgError" :icon="itemIconOrPlaceholder(pendingItemName)" :item="pendingItemName" :type="avgSellType" @switch="switchAvgType"/>
      </div>
    </BaseDialog>

    <BaseDialog :open="updateDialogOpen" title="更新商店数据" @close="cancelUpdate">
      <form class="update-form" @submit.prevent="confirmUpdate">
        <span class="charge-icon">!</span>
        <strong>更新商店价格将消耗 100 积分</strong>
        <label class="update-shop-input"><span>商店名称</span><div><input v-model="updateShopName" maxlength="256" autocomplete="off" autofocus placeholder="输入要更新的商店名称" @input="updateError = ''"/></div><small v-if="updateError">{{ updateError }}</small></label>
        <p>确定后将派 Bot 前往该商店扫描所有告示牌，同步价格并保存快照。操作最多需要 90 秒，请耐心等待。每次更新消耗 100 积分。</p>
        <div class="update-actions">
          <button type="button" class="update-cancel" :disabled="updateLoading" @click="cancelUpdate">取消</button>
          <button type="submit" class="update-ok" :disabled="updateLoading">{{ updateLoading ? '更新中…' : '确定更新' }}</button>
        </div>
      </form>
    </BaseDialog>
  </section>
</template>

<style scoped>
.shop-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin-top: 10px; overflow: hidden; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 10px 28px color-mix(in srgb, var(--shadow) 28%, transparent); }
.shop-toolbar { display: grid; flex: 0 0 48px; grid-template-columns: minmax(145px, 1fr) minmax(200px, 380px) auto auto 34px; align-items: center; gap: 8px; height: 48px; min-height: 48px; box-sizing: border-box; padding: 6px 10px; background: color-mix(in srgb, var(--surface) 32%, var(--panel-bg)); border-bottom: 1px solid var(--border); }
.shop-summary { display: flex; align-items: center; gap: 9px; }
.status-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 3px var(--success-soft); }
.status-dot.loading { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-soft); }
.shop-summary div { display: grid; gap: 2px; }
.shop-summary strong { font-size: 13px; }.shop-summary span { color: var(--muted-text); font-size: 10px; }
.shop-search { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; height: 34px; padding: 0 8px; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }
.shop-search:focus-within { color: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }
.shop-search svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
.shop-search input { min-width: 0; height: 100%; padding: 0 7px; color: var(--panel-text); background: transparent; border: 0; outline: none; font-size: 11px; }
.shop-search kbd { padding: 2px 6px; color: var(--muted-text); background: var(--surface); border-radius: 3px; font-size: 11px; }
.refresh-button { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }
.refresh-button:hover:not(:disabled) { color: var(--accent); background: var(--surface-hover); border-color: var(--accent); }.refresh-button:disabled { opacity: .5; }
.refresh-button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.refresh-button.syncing svg { animation: rotate .8s linear infinite; }
.custom-avg-button { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; }.custom-avg-button:hover { filter: brightness(1.06); }.custom-avg-button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
.update-button { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; }.update-button:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--accent); }.update-button:disabled { opacity: .5; cursor: not-allowed; }.update-button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
.shop-scroll { flex: 1 1 auto; min-height: 0; padding: 0 12px 12px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.shop-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; padding: 12px 0; }
.shop-card { display: grid; grid-template-rows: auto 1fr auto; gap: 10px; padding: 16px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; text-align: left; transition: background-color .15s ease, border-color .15s ease; cursor: pointer; }
.shop-card:hover { background: var(--surface-hover); border-color: var(--accent); }
.shop-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card-status { display: flex; align-items: center; gap: 6px; color: var(--muted-text); font-size: 11px; }.card-status i { width: 7px; height: 7px; background: var(--success); border-radius: 50%; }.card-status i.inactive { background: var(--muted-text); }
.card-name { display: flex; align-items: center; gap: 9px; min-width: 0; }.card-name svg { flex: 0 0 auto; width: 18px; height: 18px; color: var(--muted-text); fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }.card-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.card-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.card-meta time { color: var(--muted-text); font-size: 11px; }.card-meta code { overflow: hidden; color: var(--muted-text); text-overflow: ellipsis; white-space: nowrap; font-family: inherit; font-size: 11px; }
.card-action { display: flex; justify-content: end; align-items: center; gap: 4px; color: var(--muted-text); font-size: 11px; padding-top: 6px; border-top: 1px solid var(--border); }.card-action svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.shop-card:hover .card-action { color: var(--accent); }
.shop-footer { display: flex; flex: 0 0 38px; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; padding: 0 12px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); border-top: 1px solid var(--border); font-size: 11px; }
.shop-state, .dialog-state { display: grid; place-content: center; justify-items: center; gap: 8px; width: 100%; height: 100%; min-height: 260px; color: var(--muted-text); text-align: center; }
.shop-state strong, .dialog-state strong { color: var(--panel-text); font-size: 13px; }
.shop-state p, .dialog-state p { max-width: 320px; margin: 0; font-size: 12px; line-height: 1.5; }
.shop-state button, .dialog-state button { margin-top: 5px; padding: 8px 12px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 12px; font-weight: 700; }
.state-code { color: var(--accent); font-size: 11px; font-weight: 750; }
.market-loader { position: relative; display: flex; align-items: end; gap: 4px; width: 66px; height: 50px; padding: 11px 10px 9px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 5px; }
.market-loader i { display: block; flex: 1; height: 13px; background: var(--accent); border-radius: 2px 2px 0 0; animation: market-bars .8s ease-in-out infinite alternate; }
.market-loader i:nth-child(2) { height: 24px; animation-delay: -.27s; }.market-loader i:nth-child(3) { height: 18px; animation-delay: -.54s; }
.market-loader b { position: absolute; right: 7px; bottom: 7px; left: 7px; height: 2px; background: var(--accent); animation: market-scan 1s ease-in-out infinite alternate; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.shop-dialog { display: flex; flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; margin: -16px -18px -18px; background: var(--panel-bg); }
.avg-button { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); border-radius: 4px; font-size: 12px; font-weight: 700; white-space: nowrap; }.avg-button small { padding-left: 6px; color: inherit; border-left: 1px solid color-mix(in srgb, var(--accent-contrast) 45%, transparent); font-size: 11px; }
.avg-button:disabled { opacity: .5; cursor: not-allowed; }
.type-switch { display: flex; padding: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.type-switch button { height: 30px; padding: 0 11px; color: var(--muted-text); background: transparent; border: 0; border-radius: 2px; font-size: 12px; }.type-switch button.active { color: var(--panel-text); background: var(--panel-bg); box-shadow: 0 1px 3px color-mix(in srgb, var(--shadow) 25%, transparent); font-weight: 700; }
.confirm-charge { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 14px 12px; width: min(430px, 100%); color: var(--panel-text); }
.charge-icon { display: grid; place-items: center; width: 36px; height: 36px; color: var(--warning-text); background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border)); border-radius: 50%; font-size: 18px; font-weight: 800; line-height: 1; }
.confirm-charge > strong { display: flex; align-items: center; min-height: 36px; font-size: 14px; line-height: 1.4; }
.confirm-type { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.confirm-type > span:first-child { color: var(--muted-text); font-size: 12px; }
.confirm-item-input { grid-column: 1 / -1; display: grid; gap: 6px; }.confirm-item-input > span { color: var(--muted-text); font-size: 12px; }.confirm-item-input > div { display: grid; grid-template-columns: 32px minmax(0,1fr); align-items: center; gap: 8px; min-height: 46px; padding: 5px 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.confirm-item-input:focus-within > div { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }.confirm-item-input input { min-width: 0; width: 100%; height: 34px; padding: 0; color: var(--panel-text); background: transparent; border: 0; outline: 0; font-size: 13px; }.confirm-item-input small { color: var(--danger); font-size: 11px; }
.confirm-charge > p { grid-column: 1 / -1; margin: 0; padding: 11px 12px; color: var(--muted-text); background: color-mix(in srgb, var(--warning-soft) 45%, transparent); border-left: 3px solid var(--warning); font-size: 12px; line-height: 1.65; }
.confirm-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
.confirm-actions button { min-width: 88px; height: 36px; padding: 0 14px; border-radius: 4px; font-size: 12px; font-weight: 700; }
.confirm-cancel { color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); }.confirm-cancel:hover { background: var(--surface-hover); }
.confirm-ok { color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); }.confirm-ok:disabled { opacity: .5; cursor: not-allowed; }
.update-form { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 14px 12px; width: min(430px, 100%); color: var(--panel-text); }.update-form > strong { display: flex; align-items: center; min-height: 36px; font-size: 14px; line-height: 1.4; }.update-form > p { grid-column: 1 / -1; margin: 0; padding: 11px 12px; color: var(--muted-text); background: color-mix(in srgb, var(--warning-soft) 45%, transparent); border-left: 3px solid var(--warning); font-size: 12px; line-height: 1.65; }
.update-shop-input { grid-column: 1 / -1; display: grid; gap: 6px; }.update-shop-input > span { color: var(--muted-text); font-size: 12px; }.update-shop-input > div { display: grid; grid-template-columns: minmax(0,1fr); align-items: center; min-height: 46px; padding: 5px 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.update-shop-input:focus-within > div { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }.update-shop-input input { min-width: 0; width: 100%; height: 34px; padding: 0; color: var(--panel-text); background: transparent; border: 0; outline: 0; font-size: 13px; }.update-shop-input small { color: var(--danger); font-size: 11px; }
.update-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }.update-actions button { min-width: 88px; height: 36px; padding: 0 14px; border-radius: 4px; font-size: 12px; font-weight: 700; }
.update-cancel { color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); }.update-cancel:hover:not(:disabled) { background: var(--surface-hover); }.update-cancel:disabled { opacity: .5; cursor: not-allowed; }
.update-ok { color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); }.update-ok:disabled { opacity: .5; cursor: not-allowed; }
.avg-dialog { display: grid; min-height: 240px; margin: -16px -18px -18px; }
.avg-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 10px 18px; border-bottom: 1px solid var(--border); }
.avg-head-left { display: flex; align-items: center; min-width: 0; gap: 10px; }.avg-head-left > div { display: grid; min-width: 0; gap: 2px; }.avg-head-left span { color: var(--muted-text); font-size: 10px; }.avg-head-left strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.avg-summary { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(250px, 1fr); min-height: 168px; border-bottom: 1px solid var(--border); }
.avg-result { display: grid; align-content: center; justify-items: start; gap: 5px; padding: 24px 28px; background: color-mix(in srgb, var(--surface) 42%, var(--panel-bg)); border-right: 1px solid var(--border); }.avg-result span { color: var(--muted-text); font-size: 12px; }.avg-result strong { color: var(--accent); font-size: 34px; font-weight: 780; line-height: 1.15; }.avg-result small { color: var(--muted-text); font-size: 10px; }
.avg-metrics { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0; }.avg-metrics div { display: grid; align-content: center; justify-items: center; gap: 8px; padding: 12px 8px; border-right: 1px solid var(--border); }.avg-metrics div:last-child { border-right: 0; }.avg-metrics dt { color: var(--muted-text); font-size: 10px; white-space: nowrap; }.avg-metrics dd { margin: 0; font-size: 22px; font-weight: 750; }.avg-metrics .warning dd { color: var(--danger); }
.avg-no-sample { display: grid; justify-items: center; gap: 5px; padding: 40px 20px; background: var(--surface); border-bottom: 1px solid var(--border); text-align: center; }.avg-no-sample strong { font-size: 16px; }.avg-no-sample span { color: var(--muted-text); font-size: 11px; }
.avg-ledger { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 18px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 55%, var(--panel-bg)); border-bottom: 1px solid var(--border); font-size: 11px; }.avg-ledger strong { color: var(--panel-text); font-size: 11px; }.avg-ledger i { flex: 1; height: 1px; background: var(--border); }
.avg-sources > header { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 8px 18px; border-bottom: 1px solid var(--border); }.avg-sources > header div { display: grid; gap: 2px; }.avg-sources > header strong { font-size: 13px; }.avg-sources > header span, .avg-sources > header small { color: var(--muted-text); font-size: 10px; }
.avg-source-groups { display: grid; grid-template-columns: 1fr 1fr; max-height: 230px; overflow-y: auto; scrollbar-width: thin; }.avg-source-group + .avg-source-group { border-left: 1px solid var(--border); }.avg-source-label { display: flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 14px; color: var(--muted-text); background: var(--surface); border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 700; }.avg-source-label > span { width: 7px; height: 7px; background: var(--success); border-radius: 50%; }.avg-source-label.outlier > span { background: var(--danger); }.avg-source-label small { margin-left: auto; color: inherit; font-size: 10px; }
.avg-source-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.avg-source-list span, .avg-source-list em { min-height: 38px; padding: 11px 14px; overflow: hidden; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-style: normal; }.avg-source-list.outlier span { color: var(--danger); background: color-mix(in srgb, var(--danger) 4%, transparent); }.avg-source-list em { grid-column: 1 / -1; color: var(--muted-text); text-align: center; }.avg-shops-empty { display: grid; place-content: center; min-height: 80px; color: var(--muted-text); font-size: 11px; }
.shop-workspace { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; width: 100%; }
.workspace-head { display: grid; grid-template-columns: minmax(210px, .8fr) auto minmax(220px, 1fr) 120px; align-items: center; gap: 16px; min-height: 72px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
.snapshot-meta { display: grid; min-width: 0; gap: 3px; }.snapshot-meta span { color: var(--muted-text); font-size: 11px; font-weight: 600; }.snapshot-meta strong { font-size: 13px; }.snapshot-meta code { overflow: hidden; color: var(--muted-text); text-overflow: ellipsis; white-space: nowrap; font-family: inherit; font-size: 11px; }
.workspace-head dl { display: flex; gap: 16px; margin: 0; }.workspace-head dl div { display: flex; align-items: baseline; gap: 6px; }.workspace-head dt { color: var(--muted-text); font-size: 11px; }.workspace-head dd { margin: 0; font-size: 14px; font-weight: 700; }
.workspace-search { display: grid; grid-template-columns: 20px minmax(0,1fr); align-items: center; height: 40px; padding: 0 10px; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.workspace-search:focus-within { color: var(--accent); border-color: var(--accent); }.workspace-search svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }.workspace-search input { min-width: 0; height: 100%; padding: 0 7px; color: var(--panel-text); background: transparent; border: 0; outline: none; font-size: 13px; }
.workspace-columns { display: grid; flex: 1 1 auto; grid-template-columns: minmax(260px, 30%) minmax(0, 1fr); min-width: 0; min-height: 0; }
.item-index { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--border); }.item-index > header { display: flex; flex: 0 0 48px; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid var(--border); }.item-index > header strong { font-size: 13px; }.item-index > header span { color: var(--muted-text); font-size: 11px; }
.item-index-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }.item-index-scroll > button { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 66px; padding: 10px 14px; color: var(--panel-text); background: transparent; border: 0; border-bottom: 1px solid var(--border); text-align: left; }.item-index-scroll > button:hover { background: var(--surface-hover); }.item-index-scroll > button.selected { background: var(--surface-selected); box-shadow: inset 3px 0 var(--accent); }.item-index-scroll > button > span:last-child { display: grid; min-width: 0; justify-items: end; gap: 5px; }
.item-icon-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
.item-icon { flex: 0 0 auto; width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated; border-radius: 3px; background: color-mix(in srgb, var(--surface) 60%, transparent); }
.item-icon-wrap .item-icon { width: 28px; height: 28px; }
.detail-icon { width: 36px; height: 36px; }
.quote-icon { width: 28px; height: 28px; margin-bottom: 4px; }
.confirm-icon { width: 24px; height: 24px; }
.avg-icon { width: 32px; height: 32px; }
.detail-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.item-index-scroll strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.item-index-scroll small { color: var(--muted-text); font-size: 11px; }.item-index-scroll em { padding: 3px 6px; border-radius: 3px; font-size: 11px; font-style: normal; font-weight: 700; }.item-index-scroll em.sell { color: var(--success-text); background: var(--success-soft); }.item-index-scroll em.buy { color: var(--warning-text); background: var(--warning-soft); }.item-index-scroll b { color: var(--panel-text); font-size: 12px; font-weight: 700; }
.column-empty { display: grid; place-content: center; justify-items: center; min-height: 160px; padding: 24px; color: var(--muted-text); font-size: 12px; text-align: center; }
.detail-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }.detail-placeholder { display: grid; flex: 1; place-content: center; justify-items: center; gap: 8px; padding: 24px; color: var(--muted-text); text-align: center; }.detail-placeholder svg { width: 32px; height: 32px; margin-bottom: 6px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }.detail-placeholder strong { color: var(--panel-text); font-size: 16px; }.detail-placeholder p { margin: 0; font-size: 12px; }
.detail-head { display: flex; flex: 0 0 68px; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 16px; border-bottom: 1px solid var(--border); }.detail-head > div:first-child { min-width: 0; }.detail-head span { color: var(--muted-text); font-size: 11px; }.detail-head h3 { margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; }.detail-actions { display: flex; align-items: center; gap: 8px; }
.avg-button { height: 36px; padding: 0 12px; font-size: 12px; }.avg-button small { font-size: 11px; }.type-switch button { height: 30px; padding: 0 11px; font-size: 12px; }
.quote-section, .history-section { min-width: 0; }.quote-section { flex: 0 0 auto; max-height: 42%; overflow: hidden; border-bottom: 1px solid var(--border); }.quote-section > header, .history-section > header { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--border); }.quote-section > header strong, .history-section > header strong { font-size: 13px; }.quote-section > header span, .history-section > header span { color: var(--muted-text); font-size: 11px; }
.quote-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); max-height: 210px; overflow-y: auto; }.quote-card { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 8px 14px; min-height: 92px; padding: 12px 16px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }.quote-card > div { display: grid; min-width: 0; gap: 4px; }.quote-card > div span { color: var(--muted-text); font-size: 11px; }.quote-card > div strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.quote-card .quote-price { grid-row: span 2; align-content: center; }.quote-price strong { font-size: 20px !important; }.empty-inline { display: grid; place-content: center; min-height: 90px; color: var(--muted-text); font-size: 12px; }
.history-section { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }.history-layout { display: grid; flex: 1 1 auto; grid-template-columns: minmax(300px, 1fr) minmax(280px, .9fr); min-height: 0; }.history-layout .chart-wrap { position: relative; display: grid; place-items: center; height: 100%; min-height: 200px; overflow: hidden; background: color-mix(in srgb, var(--surface) 42%, var(--panel-bg)); border-right: 1px solid var(--border); }.chart-single { display: grid; place-content: center; justify-items: center; gap: 7px; min-height: 200px; padding: 24px; background: color-mix(in srgb, var(--surface) 42%, var(--panel-bg)); border-right: 1px solid var(--border); text-align: center; }.chart-single span { color: var(--muted-text); font-size: 11px; }.chart-single strong { color: var(--accent); font-size: 28px; line-height: 1.2; }.chart-single time { color: var(--muted-text); font-size: 11px; }.history-chart { display: block; width: 100%; height: 100%; min-height: 200px; }.history-chart line { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }.history-chart polyline { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }.chart-scale { position: absolute; inset: 10px 10px 10px auto; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }.chart-scale span { padding: 2px 5px; color: var(--muted-text); background: color-mix(in srgb, var(--panel-bg) 88%, transparent); border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 3px; font-size: 10px; line-height: 1.3; }.history-table { min-height: 0; overflow: auto; }.history-table table { width: 100%; border-collapse: collapse; }.history-table th { position: sticky; top: 0; padding: 10px 12px; color: var(--muted-text); background: var(--surface); border-bottom: 1px solid var(--border); text-align: left; font-size: 11px; }.history-table td { padding: 9px 12px; color: var(--muted-text); border-bottom: 1px solid var(--border); font-size: 12px; white-space: nowrap; }.history-table td strong { color: var(--panel-text); font-size: 12px; }.history-state { display: flex; flex: 1; align-items: center; justify-content: center; gap: 10px; color: var(--muted-text); font-size: 12px; }.history-state.error { color: var(--danger); }.mini-spinner { width: 22px; height: 22px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: rotate .75s linear infinite; }
.mini-empty { display: grid; flex: 1 1 auto; place-content: center; min-height: 200px; padding: 24px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); font-size: 12px; text-align: center; }
@keyframes rotate { to { transform: rotate(360deg); } }@keyframes market-bars { from { opacity: .38; transform: scaleY(.5); transform-origin: bottom; } to { opacity: 1; transform: scaleY(1); transform-origin: bottom; } }@keyframes market-scan { from { transform: translateX(-35%); } to { transform: translateX(35%); } }
@media (max-width: 760px) {
  .shop-toolbar { grid-template-columns: minmax(0,1fr) auto auto 36px; }.shop-summary { grid-column: 1 / -1; }.shop-search { grid-column: 1; }.update-button { grid-column: 2; }.custom-avg-button { grid-column: 3; }.refresh-button { grid-column: 4; }
  .shop-list { grid-template-columns: 1fr; }
  .shop-dialog { display: block; min-height: 0; margin: 0; }.shop-workspace { min-height: 0; }.workspace-head { grid-template-columns: minmax(0,1fr) 120px; gap: 10px; padding: 12px; }.snapshot-meta, .workspace-head dl { grid-column: 1 / -1; }.workspace-head dl { justify-content: space-between; }.workspace-search { grid-column: 1; }.workspace-columns { display: block; }.item-index { height: min(38dvh, 320px); min-height: 240px; border-right: 0; border-bottom: 1px solid var(--border); }.detail-pane { min-height: 0; overflow: visible; }.detail-head { position: sticky; z-index: 2; top: 0; background: var(--panel-bg); }.quote-section { max-height: none; }.quote-grid { max-height: 240px; }.history-section { min-height: 260px; }.history-layout { grid-template-columns: 1fr; }.history-layout .chart-wrap, .chart-single { height: 200px; min-height: 200px; border-right: 0; border-bottom: 1px solid var(--border); }.history-table { max-height: 260px; min-height: 0; }.mini-empty { min-height: 220px; }
}
@media (max-width: 480px) {
  .shop-scroll { padding-inline: 8px; }.shop-toolbar { padding: 8px; }.shop-footer span:last-child { display: none; }
  .custom-avg-button { width: 36px; padding: 0; justify-content: center; }.custom-avg-button span { display: none; }
  .update-button { width: 36px; padding: 0; justify-content: center; }.update-button span { display: none; }
  .workspace-head { grid-template-columns: 1fr; }.workspace-head > * { grid-column: 1; }.workspace-head dl { gap: 8px; }.workspace-head dl div { display: grid; justify-items: center; gap: 2px; }.detail-head { align-items: flex-start; flex-direction: column; min-height: 112px; padding: 10px 12px; }.detail-actions { width: 100%; justify-content: space-between; }.detail-actions .type-switch { flex: 1; }.detail-actions .type-switch button { flex: 1; }.quote-grid { grid-template-columns: 1fr; }.quote-card { grid-template-columns: 88px minmax(0,1fr); padding-inline: 12px; }.item-index { height: min(34dvh, 280px); min-height: 220px; }.history-section > header, .quote-section > header { padding-inline: 12px; }
  .confirm-type { align-items: stretch; flex-direction: column; gap: 8px; }.confirm-type .type-switch { width: 100%; }.confirm-type .type-switch button { flex: 1; }.confirm-actions button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .refresh-button.syncing svg, .market-loader i, .market-loader b, .mini-spinner { animation: none; }.shop-row { transition: none; } }
/* Shared exploration title bar dimensions. */
.shop-toolbar {
  height: 50.57px !important;
  min-height: 50.57px !important;
  max-height: 50.57px !important;
  flex: 0 0 50.57px;
  box-sizing: border-box;
  padding: 6px 12px;
  overflow: hidden;
  align-items: center !important;
}
.shop-summary, .shop-search, .custom-avg-button, .update-button, .refresh-button { align-self: center; }
.shop-search, .refresh-button, .custom-avg-button, .update-button { height: 30px; }
.refresh-button { width: 30px; }
.custom-avg-button, .update-button { padding-inline: 8px; font-size: 10px; }
.custom-avg-button svg, .update-button svg { width: 14px; height: 14px; }
.shop-search { padding-inline: 7px; }
.shop-toolbar { grid-template-columns: minmax(135px, 1fr) minmax(180px, 360px) auto auto 30px; gap: 7px; }
.shop-summary { gap: 7px; }
.status-dot { width: 7px; height: 7px; }
.shop-summary strong { font-size: 12px; }
.shop-summary span { font-size: 9px; }
.shop-summary strong, .shop-summary span { line-height: 1.1; }
</style>
