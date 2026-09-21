<script setup lang="ts">
import type {ShopAverageResponse, ShopSellType} from '../utils/shop'

defineProps<{item: string; icon: string; type: ShopSellType; data: ShopAverageResponse | null; error?: string}>()
const emit = defineEmits<{switch: [type: ShopSellType]}>()

function formatPrice(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})
    : '—'
}
</script>

<template>
  <div class="report">
    <section class="result-pane">
      <header class="report-head">
        <div class="report-item"><img :src="icon" alt=""/><div><span>查询物品</span><strong>{{ item }}</strong></div></div>
        <div class="report-switch"><button :class="{active: type === 'sell'}" type="button" @click="emit('switch', 'sell')">出售</button><button :class="{active: type === 'buy'}" type="button" @click="emit('switch', 'buy')">收购</button></div>
      </header>
      <div v-if="error" class="error-state"><span>查询失败</span><strong>无法获取{{ type === 'sell' ? '出售' : '收购' }}均价</strong><p>{{ error }}</p></div>
      <template v-else-if="data?.average">
        <div class="price"><span>全服{{ type === 'sell' ? '出售' : '收购' }}均价</span><strong>{{ formatPrice(data.average.average) }}</strong><small>已按 IQR 规则过滤异常价格</small></div>
        <dl class="metrics"><div><dt>采集商店</dt><dd>{{ data.average.shop_count + data.average.outlier_count }}</dd></div><div><dt>有效样本</dt><dd>{{ data.average.shop_count - data.average.adjusted_count }}</dd></div><div><dt>修正纳入</dt><dd>{{ data.average.adjusted_count }}</dd></div><div :class="{warning: data.average.outlier_count}"><dt>异常剔除</dt><dd>{{ data.average.outlier_count }}</dd></div></dl>
      </template>
      <div v-else class="empty"><strong>暂无可用样本</strong><span>当前没有足够报价用于计算均价。</span></div>
      <div v-if="data && !error" class="ledger"><span>本次查询</span><strong>-{{ data.charged_point }} 积分</strong><i/><span>账户余额</span><strong>{{ formatPrice(data.point) }}</strong></div>
    </section>
    <section class="sources">
      <header><div><strong>样本来源</strong><span>{{ type === 'sell' ? '出售' : '收购' }}报价</span></div><small v-if="data?.average">{{ data.average.shop_count + data.average.outlier_count }} 家商店</small></header>
      <div v-if="data?.average && !error" class="source-groups">
        <div class="source-group"><div class="source-label valid"><i/>纳入计算 <small>{{ data.average.shop_count - data.average.adjusted_count }}</small></div><div class="source-list"><span v-for="shop in data.average.shops" :key="shop">{{ shop }}</span><em v-if="!data.average.shops.length">无</em></div></div>
        <div v-if="data.average.adjusted_count" class="source-group"><div class="source-label adjusted"><i/>已修正后纳入 <small>{{ data.average.adjusted_count }}</small></div><div class="source-list adjusted"><span v-for="shop in data.average.adjusted_shops" :key="shop">{{ shop }}</span><em v-if="!data.average.adjusted_shops.length">无</em></div></div>
        <div class="source-group"><div class="source-label rejected"><i/>异常剔除 <small>{{ data.average.outlier_count }}</small></div><div class="source-list rejected"><span v-for="shop in data.average.outlier_shops" :key="shop">{{ shop }}</span><em v-if="!data.average.outlier_shops.length">无</em></div></div>
      </div>
      <div v-else class="source-empty">暂无来源商店</div>
    </section>
  </div>
</template>

<style scoped>
.report { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(0, 1.1fr); width: 100%; max-width: 100%; min-height: 390px; overflow: hidden; color: var(--panel-text); border: 1px solid var(--border); border-radius: 4px; }
.result-pane { display: flex; flex-direction: column; min-width: 0; background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); border-right: 1px solid var(--border); }
.report-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; padding: 10px 18px; border-bottom: 1px solid var(--border); }
.report-item { display: flex; align-items: center; min-width: 0; gap: 10px; }.report-item img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }.report-item div { display: grid; min-width: 0; gap: 2px; }.report-item span { color: var(--muted-text); font-size: 10px; }.report-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.report-switch { display: flex; padding: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.report-switch button { height: 30px; padding: 0 13px; color: var(--muted-text); background: transparent; border: 0; border-radius: 2px; font-size: 12px; }.report-switch button.active { color: var(--panel-text); background: var(--panel-bg); box-shadow: 0 1px 3px color-mix(in srgb, var(--shadow) 25%, transparent); font-weight: 700; }
.price { display: grid; flex: 1 1 auto; align-content: center; justify-items: start; gap: 6px; min-height: 180px; padding: 28px; border-bottom: 1px solid var(--border); }.price span { color: var(--muted-text); font-size: 12px; }.price strong { color: var(--accent); font-size: 38px; font-weight: 780; line-height: 1.15; }.price small { color: var(--muted-text); font-size: 10px; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); margin: 0; }.metrics div { display: grid; align-content: center; justify-items: center; gap: 8px; padding: 12px 8px; border-right: 1px solid var(--border); }.metrics div:last-child { border-right: 0; }.metrics dt { color: var(--muted-text); font-size: 10px; white-space: nowrap; }.metrics dd { margin: 0; font-size: 22px; font-weight: 750; }.metrics .warning dd { color: var(--danger); }
.empty { display: grid; flex: 1; place-content: center; justify-items: center; gap: 5px; min-height: 240px; padding: 40px 20px; }.empty span { color: var(--muted-text); font-size: 11px; }
.error-state { display: grid; flex: 1; place-content: center; justify-items: center; gap: 6px; min-height: 280px; padding: 40px 24px; text-align: center; }.error-state > span { color: var(--danger); font-size: 10px; font-weight: 750; }.error-state strong { font-size: 16px; }.error-state p { max-width: 280px; margin: 0; color: var(--muted-text); font-size: 11px; line-height: 1.6; }
.ledger { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 18px; color: var(--muted-text); background: color-mix(in srgb, var(--surface) 55%, var(--panel-bg)); border-top: 1px solid var(--border); font-size: 11px; }.ledger strong { color: var(--panel-text); }.ledger i { flex: 1; height: 1px; background: var(--border); }
.sources { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.sources > header { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 8px 18px; border-bottom: 1px solid var(--border); }.sources > header div { display: grid; gap: 2px; }.sources > header strong { font-size: 13px; }.sources > header span, .sources > header small { color: var(--muted-text); font-size: 10px; }
.source-groups { flex: 1; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; }.source-group { min-width: 0; }.source-group + .source-group { border-top: 1px solid var(--border); }.source-label { display: flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 14px; color: var(--muted-text); background: var(--surface); border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 700; }.source-label i { width: 7px; height: 7px; background: var(--success); border-radius: 50%; }.source-label.rejected i { background: var(--danger); }.source-label.adjusted i { background: var(--warning); }
.source-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.source-list span, .source-list em { min-height: 38px; padding: 11px 14px; overflow: hidden; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-style: normal; }.source-list.rejected span { color: var(--danger); background: color-mix(in srgb, var(--danger) 4%, transparent); }.source-list.adjusted span { color: var(--warning-text); background: color-mix(in srgb, var(--warning) 4%, transparent); }.source-list em { grid-column: 1 / -1; color: var(--muted-text); text-align: center; }.source-empty { display: grid; place-content: center; min-height: 80px; color: var(--muted-text); font-size: 11px; }
@media (max-width: 760px) {
  .report { grid-template-columns: 1fr; min-height: 0; }
  .result-pane { border-right: 0; border-bottom: 1px solid var(--border); }
  .report-head { min-height: 56px; padding: 8px 12px; }
  .price { justify-items: center; min-height: 124px; padding: 20px 16px; text-align: center; }
  .price strong { font-size: 32px; }
  .metrics div { min-height: 76px; padding: 9px 5px; }
  .metrics dd { font-size: 19px; }
  .ledger { min-height: 42px; padding-inline: 12px; }
  .sources { min-height: 220px; }
  .sources > header { min-height: 46px; padding-inline: 12px; }
  .source-groups { max-height: 280px; }
  .source-list { grid-template-columns: 1fr; }
  .source-list span, .source-list em { min-height: 36px; padding: 10px 12px; }
  .error-state, .empty { min-height: 180px; padding: 28px 18px; }
}
@media (max-width: 480px) {
  .report-head { align-items: stretch; flex-direction: column; gap: 8px; }
  .report-switch { width: 100%; }
  .report-switch button { flex: 1; }
  .price { min-height: 112px; }
  .price strong { font-size: 28px; }
  .metrics dt { white-space: normal; text-align: center; }
  .ledger { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; padding-block: 8px; }
  .ledger i { display: none; }
  .ledger strong { text-align: right; }
  .sources { min-height: 190px; }
  .source-groups { max-height: 240px; }
}
</style>
