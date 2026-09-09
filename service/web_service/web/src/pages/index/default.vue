<script lang="ts" setup>
import {computed} from 'vue'
import {openLogin} from '../../router'
import {useAlertStore} from '../../stores/alert'
import {usePlayerInfoStore} from '../../stores/playerInfo'
import {useAuthStore} from '../../stores/auth'
import BaseTooltip from '../../components/BaseTooltip.vue'

const emit = defineEmits<{ changeView: [view: 'profile' | 'server'] }>()
const authStore = useAuthStore()
const playerInfo = usePlayerInfoStore()
const alertStore = useAlertStore()
const serverAddress = computed(() => {
  if (!playerInfo.motd) return 'mc.bangxi.top'
  return `${playerInfo.motd.host}${playerInfo.motd.port === 25565 ? '' : `:${playerInfo.motd.port}`}`
})
const resolvedEndpoint = computed(() => {
  if (!playerInfo.motd) return '等待服务器响应'
  const ip = playerInfo.motd.ip.includes(':') ? `[${playerInfo.motd.ip}]` : playerInfo.motd.ip
  return `${ip}:${playerInfo.motd.port}`
})
const visiblePlayers = computed(() => playerInfo.players.slice(0, 4))
const capacity = computed(() => {
  const motd = playerInfo.motd
  if (!motd?.max) return 0
  return Math.min(100, Math.round((motd.online / motd.max) * 100))
})

function copyServerAddress() {
  copyText(serverAddress.value, '服务器地址')
}

function handlePrimaryAction() {
  if (authStore.isLoggedIn) emit('changeView', 'profile')
  else openLogin()
}

function copyText(value: string, label: string) {
  const input = document.createElement('textarea')
  input.value = value
  input.readOnly = true
  input.setAttribute('aria-hidden', 'true')
  input.style.position = 'fixed'
  input.style.inset = '-9999px auto auto -9999px'
  document.body.appendChild(input)
  input.select()
  input.setSelectionRange(0, input.value.length)

  try {
    if (!document.execCommand('copy')) throw new Error('copy command failed')
    alertStore.success(`${label}已复制`, value)
  } catch {
    alertStore.error('复制失败', `请手动输入 ${value}`)
  } finally {
    input.remove()
  }
}
</script>

<template>
  <section class="guest-home">
    <header class="home-head">
      <div class="head-brand">
        <i :class="{ online: playerInfo.motd }"/>
        <span>BANGXI SERVER INFO</span>
        <em>POWERED BY WP</em>
      </div>
    </header>

    <div class="home-grid">
      <div class="intro">
        <h1>不只进入世界，<br/><span>也留下你的世界</span></h1>
        <p>邦溪服务器的数据入口。查看实时状态、追踪游戏历程，把散落在世界里的资产、地标与故事整理成一份长期档案。</p>

        <div class="intro-actions">
          <button :class="{ 'login-action': !authStore.isLoggedIn }" class="primary-action"
                  @click="handlePrimaryAction">
            <span>{{ authStore.isLoggedIn ? '查看玩家档案' : '登录玩家档案' }}</span><b aria-hidden="true">↗</b>
          </button>
          <BaseTooltip placement="top" text="复制服务器地址">
            <button class="address-chip" type="button" @click="copyServerAddress">
              <small>SERVER ADDRESS</small><strong>{{ serverAddress }}</strong><b aria-hidden="true">复制</b>
            </button>
          </BaseTooltip>
        </div>

        <ul class="feature-list">
          <li><b>01</b><span>玩家档案</span><small>在线时长与旅程记录</small></li>
          <li><b>02</b><span>世界索引</span><small>地标与社区发现</small></li>
          <li><b>03</b><span>资产追踪</span><small>金币与积分变化</small></li>
        </ul>
      </div>

      <aside id="server-status" class="server-panel">
        <header class="panel-head">
          <div class="panel-title"><span>SERVER / LIVE SIGNAL</span><strong>实时世界状态</strong></div>
          <div class="panel-actions">
            <BaseTooltip text="刷新服务器状态，5 秒内限一次">
              <button :aria-busy="playerInfo.motdRefreshing" :disabled="playerInfo.motdRefreshing" aria-label="刷新服务器状态"
                      class="motd-refresh" type="button"
                      @click="playerInfo.refreshMotd"><span>↻</span></button>
            </BaseTooltip>
            <b :class="{ online: playerInfo.motd }" class="panel-state">{{
                playerInfo.motd ? 'ONLINE' : playerInfo.loading ? 'SYNCING' : 'UNKNOWN'
              }}</b>
          </div>
        </header>

        <div class="motd-stage">
          <div
              :class="{ empty: !playerInfo.motd?.favicon }"
              :style="playerInfo.motd?.favicon ? { backgroundImage: `url(${playerInfo.motd.favicon})` } : undefined"
              class="server-icon"
          ><span v-if="!playerInfo.motd?.favicon">BX</span></div>
          <div v-if="playerInfo.motd" class="motd-copy">
            <span>MINECRAFT JAVA EDITION</span>
            <strong v-html="playerInfo.motd.motd_html || playerInfo.motd.motd"/>
            <small>{{ playerInfo.motd.version }} · PROTOCOL {{ playerInfo.motd.agreement }}</small>
          </div>
          <div v-else class="motd-copy unavailable">
            <span>MINECRAFT JAVA EDITION</span>
            <strong>{{ playerInfo.loading ? '正在连接世界...' : '暂时无法读取 MOTD' }}</strong>
            <small>{{ playerInfo.loading ? '正在同步服务器握手信息' : '将在下一周期自动重试' }}</small>
          </div>
        </div>

        <div class="status-metrics">
          <article><span>PLAYERS</span><strong>{{ playerInfo.available ? playerInfo.playerCount : '—' }}<small>/
            {{ playerInfo.motd?.max ?? '—' }}</small></strong><b>在线玩家</b></article>
          <article><span>LATENCY</span><strong>{{
              playerInfo.motd?.delay ?? '—'
            }}<small>ms</small></strong><b>网络响应</b></article>
          <article><span>VERSION</span><strong class="version">{{
              playerInfo.motd?.version || '—'
            }}</strong><b>服务版本</b></article>
        </div>

        <div class="panel-lower">
          <div class="connect-row">
            <header><span>CONNECTION</span><b>连接详情</b></header>
            <dl>
              <div>
                <dt>公开地址</dt>
                <dd>
                  <BaseTooltip placement="top" text="复制服务器地址">
                    <button type="button" @click="copyServerAddress">{{ serverAddress }}</button>
                  </BaseTooltip>
                </dd>
              </div>
              <div>
                <dt>解析节点</dt>
                <dd>
                  <BaseTooltip placement="top" text="复制 DNS 解析节点">
                    <button type="button" @click="copyText(resolvedEndpoint, 'DNS 解析节点')">{{
                        resolvedEndpoint
                      }}
                    </button>
                  </BaseTooltip>
                </dd>
              </div>
              <div>
                <dt>服务端口</dt>
                <dd>{{ playerInfo.motd?.port ?? '—' }}</dd>
              </div>
              <div>
                <dt>协议版本</dt>
                <dd>{{ playerInfo.motd?.agreement ?? '—' }}</dd>
              </div>
            </dl>
          </div>

          <div class="player-preview">
            <header><span>PLAYER SAMPLE</span><b>{{ capacity }}% 容量</b></header>
            <div v-if="visiblePlayers.length" class="player-list">
              <span v-for="player in visiblePlayers" :key="player.uuid || player.username"><i>{{
                  player.username.charAt(0).toUpperCase()
                }}</i><b>{{ player.username }}</b><small>{{
                  player.ping === null ? '—' : `${player.ping}ms`
                }}</small></span>
            </div>
            <p v-else>{{ playerInfo.available ? '当前没有可展示的在线玩家' : '等待 Bot 提供的在线玩家列表' }}</p>
            <i class="capacity-bar"><em :style="{ width: `${capacity}%` }"/></i>
          </div>
        </div>

        <footer class="panel-foot">
          <span><i :class="{ online: playerInfo.motd }"/>{{
              playerInfo.motd ? 'Status ping completed' : 'Waiting for status ping'
            }}</span>
          <b>REFRESH / 15S</b>
        </footer>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.guest-home {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: auto;
  min-height: 100%;
  gap: 18px;
  width: 100%;
  padding: 0;
}

.home-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--page-text) 15%, transparent);
}

.head-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--page-muted);
  font: 700 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .13em;
}

.head-brand i {
  width: 7px;
  height: 7px;
  background: var(--muted-text);
  border-radius: 50%;
}

.head-brand i.online {
  background: var(--success);
  box-shadow: 0 0 12px var(--success);
}

.head-brand em {
  color: color-mix(in srgb, var(--page-muted) 60%, transparent);
  font-style: normal;
  font-weight: 500;
}

.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(600px, .95fr);
  align-items: start;
  gap: 20px;
}

.intro {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-top: 6px;
}

.intro h1 {
  margin: 0 0 20px;
  font-size: clamp(44px, 4.6vw, 68px);
  font-weight: 780;
  line-height: .98;
  letter-spacing: -.055em;
}

.intro h1 span {
  color: var(--accent);
}

.intro > p {
  max-width: 620px;
  margin: 0;
  color: var(--page-muted);
  font-size: clamp(15px, 1.1vw, 17px);
  line-height: 1.75;
}

.intro-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 26px;
}

.primary-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
  min-height: 50px;
  min-width: 200px;
  padding: 0 18px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  font-size: 14px;
  font-weight: 750;
  transition: transform .2s ease, filter .2s ease;
}

.primary-action:hover {
  filter: brightness(1.08);
  transform: translateY(-2px);
}

.primary-action b {
  font-size: 18px;
  font-weight: 400;
}

.primary-action.login-action {
  color: var(--warning-text);
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 62%, var(--border));
}

.primary-action.login-action:hover {
  color: var(--accent-contrast);
  background: var(--warning);
  border-color: var(--warning);
}

.address-chip {
  position: relative;
  display: grid;
  align-content: center;
  gap: 5px;
  min-height: 50px;
  min-width: 220px;
  padding: 0 52px 0 15px;
  color: inherit;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--page-text) 22%, transparent);
  border-radius: 4px;
  text-align: left;
  transition: border-color .2s ease, background-color .2s ease;
}

.address-chip:hover {
  background: color-mix(in srgb, var(--page-text) 5%, transparent);
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.address-chip small {
  color: var(--page-muted);
  font: 700 9px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .13em;
}

.address-chip strong {
  font: 700 14px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .03em;
}

.address-chip > b {
  position: absolute;
  top: 50%;
  right: 13px;
  color: var(--accent);
  font: 700 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  transform: translateY(-50%);
}

.feature-list {
  display: grid;
  margin: 26px 0 0;
  padding: 0;
  list-style: none;
}

.feature-list li {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  column-gap: 12px;
  padding: 13px 0;
  border-top: 1px solid color-mix(in srgb, var(--page-text) 15%, transparent);
}

.feature-list b {
  grid-row: span 2;
  align-self: center;
  color: var(--accent);
  font: 700 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.feature-list span {
  font-size: 14px;
  font-weight: 700;
}

.feature-list small {
  grid-column: 2;
  margin-top: 4px;
  color: var(--page-muted);
  font-size: 12px;
}

.server-panel {
  position: relative;
  min-width: 0;
  overflow: hidden;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 14px 40px color-mix(in srgb, var(--shadow) 40%, transparent);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 0 15px;
  border-bottom: 1px solid var(--border);
}

.panel-title span {
  display: block;
  color: var(--muted-text);
  font: 700 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .14em;
}

.panel-title strong {
  display: block;
  margin-top: 5px;
  font-size: 17px;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.motd-refresh {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--muted-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 15px;
  line-height: 1;
  transition: color .2s ease, background-color .2s ease;
}

.motd-refresh:hover:not(:disabled) {
  color: var(--accent);
  background: var(--surface-hover);
  transform: none;
}

.motd-refresh span {
  display: block;
  transform-origin: center;
}

.motd-refresh:disabled {
  cursor: wait;
  opacity: .55;
}

.motd-refresh:disabled span {
  animation: motd-spin .8s linear infinite;
}

.panel-state {
  padding: 7px 9px;
  color: var(--muted-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font: 800 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .1em;
}

.panel-state.online {
  color: var(--success-text);
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 35%, var(--border));
}

.motd-stage {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 13px 15px;
  border-bottom: 1px solid var(--border);
}

.server-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  background: var(--surface) center / cover no-repeat;
  border: 1px solid var(--border);
  border-radius: 5px;
  image-rendering: pixelated;
  box-shadow: 4px 4px 0 color-mix(in srgb, var(--accent) 18%, transparent);
}

.server-icon.empty span {
  color: var(--accent);
  font: 850 22px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.motd-copy {
  min-width: 0;
}

.motd-copy > span {
  color: var(--accent);
  font: 800 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .12em;
}

.motd-copy > strong {
  display: block;
  margin-top: 6px;
  padding: 6px 9px;
  overflow-wrap: anywhere;
  color: #fff;
  background: #17251f;
  border-radius: 4px;
  font-size: clamp(14px, 1.2vw, 17px);
  font-weight: 700;
  line-height: 1.2;
  white-space: pre-line;
}

.motd-copy > strong :deep(*) {
  text-shadow: 1px 1px 0 rgba(0, 0, 0, .72), 0 0 1px rgba(0, 0, 0, .8);
}

.motd-copy > small {
  display: block;
  margin-top: 6px;
  color: var(--muted-text);
  font: 600 10px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.motd-copy.unavailable > strong {
  color: var(--muted-text);
  background: var(--surface);
}

.status-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid var(--border);
}

.status-metrics article {
  min-width: 0;
  padding: 11px 14px;
  background: color-mix(in srgb, var(--surface) 45%, transparent);
}

.status-metrics article + article {
  border-left: 1px solid var(--border);
}

.status-metrics article > span, .status-metrics article > b {
  display: block;
  color: var(--muted-text);
  font: 700 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .1em;
}

.status-metrics article > strong {
  display: block;
  min-width: 0;
  margin: 8px 0 7px;
  overflow: hidden;
  font-size: clamp(22px, 2.2vw, 30px);
  line-height: .82;
  letter-spacing: -.06em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-metrics article > strong small {
  margin-left: 4px;
  color: var(--muted-text);
  font-size: 12px;
  letter-spacing: 0;
}

.status-metrics article > strong.version {
  font: 750 clamp(13px, 1.2vw, 17px)/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: -.03em;
}

.panel-lower {
  display: grid;
  grid-template-columns: minmax(0, .95fr) minmax(0, 1.05fr);
  border-bottom: 1px solid var(--border);
}

.connect-row {
  min-width: 0;
  padding: 12px 15px;
  border-right: 1px solid var(--border);
}

.connect-row header, .player-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 9px;
}

.connect-row header span, .player-preview > header span {
  color: var(--accent);
  font: 800 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}

.connect-row header b, .player-preview > header b {
  color: var(--muted-text);
  font: 650 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.connect-row dl {
  display: grid;
  gap: 7px;
  margin: 0;
}

.connect-row dl div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.connect-row dt {
  color: var(--muted-text);
  font-size: 10px;
  white-space: nowrap;
}

.connect-row dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  font: 650 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connect-row dd button {
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  color: inherit;
  background: transparent;
  border: 0;
  font: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connect-row dd button:hover {
  color: var(--accent);
  text-decoration: underline;
}

.player-preview {
  min-width: 0;
  padding: 12px 15px;
}

.player-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.player-list > span {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px 4px 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.player-list span i {
  display: grid;
  place-items: center;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 2px;
  font: normal 750 9px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.player-list span b {
  overflow: hidden;
  font: 650 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-list span small {
  color: var(--muted-text);
  font: 600 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.player-preview > p {
  margin: 0;
  color: var(--muted-text);
  font-size: 10px;
}

.capacity-bar {
  display: block;
  height: 4px;
  margin-top: 10px;
  overflow: hidden;
  background: var(--surface);
  border-radius: 3px;
}

.capacity-bar em {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
  transition: width .3s ease;
}

.panel-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 34px;
  padding: 0 15px;
  color: var(--muted-text);
  font: 650 10px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: .08em;
}

.panel-foot span {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-foot i {
  width: 6px;
  height: 6px;
  background: var(--muted-text);
  border-radius: 50%;
}

.panel-foot i.online {
  background: var(--success);
}

.panel-head {
  min-height: 66px;
  padding: 0 18px;
}

.panel-title span, .panel-state, .motd-copy > span, .motd-copy > small,
.status-metrics article > span, .status-metrics article > b,
.connect-row header span, .connect-row header b,
.player-preview > header span, .player-preview > header b, .panel-foot {
  font-size: 12px;
}

.panel-title strong {
  font-size: 21px;
}

.motd-refresh {
  width: 34px;
  height: 34px;
  font-size: 19px;
}

.panel-state {
  padding: 9px 11px;
}

.motd-stage {
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 16px;
  padding: 19px 18px;
}

.server-icon {
  width: 72px;
  height: 72px;
}

.server-icon.empty span {
  font-size: 28px;
}

.motd-copy > strong {
  margin-top: 8px;
  padding: 9px 11px;
  font-size: clamp(17px, 1.35vw, 20px);
  line-height: 1.28;
}

.motd-copy > small {
  margin-top: 8px;
}

.status-metrics article {
  padding: 16px 17px;
}

.status-metrics article > strong {
  margin: 11px 0 9px;
  font-size: clamp(28px, 2.5vw, 38px);
}

.status-metrics article > strong small {
  font-size: 15px;
}

.status-metrics article > strong.version {
  font-size: clamp(16px, 1.35vw, 20px);
}

.connect-row, .player-preview {
  padding: 18px;
}

.connect-row header, .player-preview > header {
  margin-bottom: 13px;
}

.connect-row dl {
  gap: 11px;
}

.connect-row dt, .connect-row dd {
  font-size: 13px;
}

.player-list {
  gap: 8px;
}

.player-list > span {
  padding: 6px 10px 6px 6px;
}

.player-list span i {
  flex-basis: 26px;
  width: 26px;
  height: 26px;
  font-size: 11px;
}

.player-list span b {
  font-size: 14px;
}

.player-list span small, .player-preview > p {
  font-size: 12px;
}

.capacity-bar {
  height: 6px;
  margin-top: 14px;
}

.panel-foot {
  min-height: 44px;
  padding: 0 18px;
}

@keyframes motd-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1120px) {
  .home-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .server-panel {
    max-width: 680px;
  }

  .intro h1 {
    font-size: clamp(44px, 8vw, 64px);
  }
}

@media (max-width: 560px) {
  .guest-home {
    height: auto;
    padding: 48px 0 28px;
  }

  .home-head {
    flex-wrap: wrap;
    gap: 12px;
  }

  .head-brand {
    gap: 7px;
    font-size: 10px;
    letter-spacing: .09em;
  }

  .head-brand em {
    display: block;
    font-size: 9px;
    letter-spacing: .04em;
  }

  .intro h1 {
    font-size: clamp(38px, 12vw, 56px);
  }

  .intro > p {
    font-size: 14px;
  }

  .intro-actions {
    display: grid;
  }

  .panel-lower {
    grid-template-columns: 1fr;
  }

  .connect-row {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .connect-row dl {
    grid-template-columns: 1fr;
  }

  .status-metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .status-metrics article:nth-child(3) {
    grid-column: 1 / -1;
    border-top: 1px solid var(--border);
    border-left: 0;
  }
}
</style>
