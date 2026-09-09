<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from './MusicIcons'
import { type MusicTrack, useMusicPlayerStore } from '../stores/musicPlayer'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const player = useMusicPlayerStore()
const queueDirection = ref<'next' | 'previous'>('next')
const observedPage = ref(player.page)

watch(() => player.page, page => {
  queueDirection.value = page >= observedPage.value ? 'next' : 'previous'
  observedPage.value = page
})

const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
const progressStyle = computed(() => ({ '--progress': `${Math.min(100, Math.max(0, player.progress * 100))}%` }))
const ambientStyle = computed(() => ({ backgroundImage: `url(${JSON.stringify(player.playerCover)})` }))
const visibleLyrics = computed(() => {
  const current = Math.max(0, player.currentLyricIndex)
  const start = Math.max(0, current - 4)
  return player.lyrics
    .slice(start, Math.min(player.lyrics.length, current + 5))
    .map((line, index) => ({ ...line, index: start + index }))
})

function seekFromEvent(event: Event) {
  player.seek(Number((event.target as HTMLInputElement).value))
}

function changeVolume(event: Event) {
  player.setVolume(Number((event.target as HTMLInputElement).value))
}

function trackTitle(track: MusicTrack) {
  return track.name || track.songname || track.filename || '未命名歌曲'
}

function trackHash(track: MusicTrack | null | undefined) {
  return track?.hash || track?.filehash || ''
}

function isCurrentTrack(track: MusicTrack) {
  const hash = trackHash(track)
  return Boolean(hash) && hash === trackHash(player.current)
}

function trackArtist(track: MusicTrack) {
  const singers = track.singerinfo?.map(singer => singer.name?.trim()).filter((name): name is string => Boolean(name))
  if (singers?.length) return singers.join(' / ')
  if (track.singername?.trim()) return track.singername.trim()
  return trackTitle(track).split(/\s+-\s+/)[0]?.trim() || '未知歌手'
}

async function changePage(nextPage: number) {
  if (player.loading || nextPage < 1 || nextPage > player.totalPages || nextPage === player.page) return
  queueDirection.value = nextPage > player.page ? 'next' : 'previous'
  await player.fetchPage(nextPage)
}
</script>

<template>
  <BaseDialog
    :open="props.open"
    size="large"
    title="正在播放"
    panel-class="music-player-panel"
    @close="emit('close')"
  >
    <section class="music-dialog">
      <div class="ambient-cover" :style="ambientStyle" aria-hidden="true" />
      <div class="ambient-shade" aria-hidden="true" />

      <aside class="now-pane">
        <Transition name="track-change" mode="out-in">
          <div :key="player.current?.hash || player.current?.filehash || player.title" class="track-visual">
            <div class="cover-wrap">
              <img :src="player.playerCover" alt="当前歌曲封面">
              <span v-if="player.trackLoading" class="cover-loading" />
            </div>
            <div class="track-heading">
              <span class="quality-badge">HQ</span>
              <span class="playlist-label">{{ player.playlistName }}</span>
            </div>
            <strong :title="player.title">{{ player.title }}</strong>
            <small>{{ player.artist }}</small>
          </div>
        </Transition>

        <div class="meter" :class="{ playing: player.playing }" aria-hidden="true">
          <i v-for="(level, index) in player.visualizerLevels" :key="index" :style="{ transform: `scaleY(${.16 + level * 1.25})` }" />
        </div>

        <label class="progress">
          <span>{{ formatTime(player.currentTime) }}</span>
          <input
            :value="player.currentTime"
            :max="player.duration || 0"
            :style="progressStyle"
            aria-label="播放进度"
            type="range"
            @input="seekFromEvent"
          >
          <span>{{ formatTime(player.duration) }}</span>
        </label>

        <div class="transport">
          <button aria-label="上一首" type="button" @click="player.previous"><SkipForwardIcon /></button>
          <button class="play" :aria-label="player.playing ? '暂停' : '播放'" type="button" @click="player.toggle">
            <PauseIcon v-if="player.playing" />
            <PlayIcon v-else />
          </button>
          <button aria-label="下一首" type="button" @click="player.next"><SkipBackIcon /></button>
        </div>

        <label class="volume-control">
          <span>音量</span>
          <input :value="player.volume" :style="{ '--volume': player.volume }" aria-label="音量" max="1" min="0" step="0.01" type="range" @input="changeVolume">
          <output>{{ Math.round(player.volume * 100) }}%</output>
        </label>
      </aside>

      <main class="lyric-pane">
        <header>
          <span>同步歌词</span>
          <strong>{{ player.artist }}</strong>
        </header>
        <div class="lyrics" aria-live="polite">
          <p v-if="!player.lyrics.length" class="empty">
            <span>暂无同步歌词</span>
            <small>{{ player.title }}</small>
          </p>
          <p
            v-for="line in visibleLyrics"
            v-else
            :key="`${line.time}:${line.index}`"
            :class="{ active: line.index === player.currentLyricIndex, past: line.index < player.currentLyricIndex }"
          >
            <span>{{ line.text }}</span>
            <small v-if="line.translation">{{ line.translation }}</small>
          </p>
        </div>
        <footer><span>LYRICS</span><b>酷狗音乐 · 同步歌词</b></footer>
      </main>

      <aside class="queue-pane">
        <header>
          <div><span>当前队列</span><strong>播放列表</strong></div>
          <b>{{ player.total }} 首</b>
        </header>
        <div class="queue-viewport">
          <Transition :name="`queue-page-${queueDirection}`" mode="out-in">
            <div :key="player.page" class="queue-list">
              <button
                v-for="(track, index) in player.tracks"
                :key="track.hash || track.filehash || index"
                :class="{ active: isCurrentTrack(track) }"
                type="button"
                @click="player.playAt(index)"
              >
                <img :src="track.cover?.replace('{size}', '60') || player.playerCover" alt="">
                <span class="queue-copy">
                  <strong>{{ trackTitle(track) }}</strong>
                  <small>{{ trackArtist(track) }} · {{ formatTime((track.timelen || 0) / 1000) }}</small>
                </span>
                <span v-if="isCurrentTrack(track)" class="queue-meter" :class="{ playing: player.playing }" aria-label="正在播放">
                  <i v-for="bar in 3" :key="bar" />
                </span>
                <span v-else class="track-number">{{ String((player.page - 1) * 30 + index + 1).padStart(2, '0') }}</span>
              </button>
            </div>
          </Transition>
        </div>
        <footer>
          <span>第 {{ player.page }} / {{ player.totalPages }} 页</span>
          <div>
            <button aria-label="上一页" :disabled="player.loading || player.page === 1" type="button" @click="changePage(player.page - 1)">‹</button>
            <button aria-label="下一页" :disabled="player.loading || player.page === player.totalPages" type="button" @click="changePage(player.page + 1)">›</button>
          </div>
        </footer>
      </aside>
    </section>
  </BaseDialog>
</template>

<style scoped>
:global(.music-player-panel) { width:min(1280px,100%); height:min(760px,calc(100dvh - 40px)); overflow:hidden; background:color-mix(in srgb,var(--panel-bg) 88%,#111820); }
:global(.music-player-panel .dialog-header) { position:relative; z-index:3; color:var(--panel-text); background:color-mix(in srgb,var(--panel-bg) 78%,transparent); border-bottom-color:color-mix(in srgb,var(--border) 70%,transparent); backdrop-filter:blur(18px); }
:global(.music-player-panel .dialog-content) { padding:0; overflow:hidden; }
.music-dialog { position:relative; isolation:isolate; display:grid; grid-template-columns:250px minmax(360px,1fr) 290px; gap:12px; flex:1; width:100%; min-height:0; padding:12px; overflow:hidden; color:var(--panel-text); }
.ambient-cover { position:absolute; z-index:-3; inset:-50px; background-position:center; background-size:cover; filter:blur(42px) saturate(.75); opacity:.34; transform:scale(1.08); }
.ambient-shade { position:absolute; z-index:-2; inset:0; background:linear-gradient(90deg,color-mix(in srgb,var(--panel-bg) 88%,transparent),color-mix(in srgb,var(--panel-bg) 74%,transparent) 54%,color-mix(in srgb,var(--panel-bg) 88%,transparent)),linear-gradient(180deg,color-mix(in srgb,var(--surface) 8%,transparent),color-mix(in srgb,var(--panel-bg) 70%,transparent)); backdrop-filter:blur(8px); }
.now-pane,.lyric-pane,.queue-pane { position:relative; z-index:1; min-width:0; min-height:0; overflow:hidden; background:color-mix(in srgb,var(--panel-bg) 72%,transparent); border:1px solid color-mix(in srgb,var(--border) 72%,transparent); border-radius:5px; box-shadow:0 14px 34px color-mix(in srgb,var(--shadow) 28%,transparent); backdrop-filter:blur(18px); }
.now-pane { display:flex; flex-direction:column; justify-content:center; padding:24px 22px; }
.track-visual { display:grid; min-width:0; }
.cover-wrap { position:relative; overflow:hidden; border:1px solid color-mix(in srgb,var(--border) 72%,transparent); border-radius:5px; box-shadow:0 18px 42px color-mix(in srgb,var(--shadow) 58%,transparent); }
.cover-wrap img { display:block; width:100%; aspect-ratio:1; object-fit:cover; }
.cover-loading { position:absolute; inset:0; display:grid; place-items:center; background:color-mix(in srgb,var(--panel-bg) 62%,transparent); }
.cover-loading::after { width:24px; height:24px; border:2px solid color-mix(in srgb,var(--panel-text) 25%,transparent); border-top-color:var(--accent); border-radius:5px; content:''; animation:cover-spin .72s linear infinite; }
.track-heading { display:flex; align-items:center; gap:6px; margin-top:14px; }
.quality-badge,.playlist-label { min-width:0; padding:3px 5px; border:1px solid color-mix(in srgb,var(--border) 76%,transparent); border-radius:4px; color:var(--muted-text); background:color-mix(in srgb,var(--panel-bg) 54%,transparent); font-size:8px; font-weight:750; }
.playlist-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.track-visual>strong,.track-visual>small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.track-visual>strong { margin-top:9px; font-size:18px; letter-spacing:-.03em; }
.track-visual>small { margin-top:4px; color:var(--muted-text); font-size:11px; }
.meter { display:flex; align-items:end; gap:2px; height:14px; margin:13px 0 7px; color:var(--accent); }
.meter i { width:3px; height:11px; background:currentColor; border-radius:2px; transform-origin:bottom; transition:transform .08s linear; }
.meter:not(.playing) i { transform:scaleY(.16)!important; }
.progress { display:grid; grid-template-columns:32px minmax(0,1fr) 32px; align-items:center; gap:7px; color:var(--muted-text); font-size:9px; font-variant-numeric:tabular-nums; }
.progress span:last-child { text-align:right; }
.progress input { width:100%; height:4px; appearance:none; border:0; border-radius:4px; outline:0; background:linear-gradient(to right,var(--accent) 0 var(--progress),color-mix(in srgb,var(--muted-text) 30%,transparent) var(--progress) 100%); cursor:pointer; }
.progress input::-webkit-slider-thumb { width:10px; height:10px; appearance:none; background:var(--accent); border:2px solid var(--panel-bg); border-radius:4px; box-shadow:0 1px 4px var(--shadow); }
.progress input::-moz-range-thumb { width:8px; height:8px; background:var(--accent); border:2px solid var(--panel-bg); border-radius:4px; }
.transport { display:flex; align-items:center; justify-content:center; gap:18px; margin-top:16px; }
.transport button,.queue-pane>footer button { display:grid; place-items:center; width:32px; height:32px; padding:0; color:var(--panel-text); background:color-mix(in srgb,var(--panel-bg) 42%,transparent); border:1px solid color-mix(in srgb,var(--border) 74%,transparent); border-radius:5px; }
.transport button:hover,.queue-pane>footer button:hover:not(:disabled) { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }
.transport button svg { width:14px; height:14px; }
.transport .play { width:42px; height:42px; color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); box-shadow:0 9px 20px color-mix(in srgb,var(--accent) 28%,transparent); }
.transport .play svg { width:17px; height:17px; }
.volume-control { display:grid; grid-template-columns:28px minmax(0,1fr) 28px; align-items:center; gap:7px; margin-top:13px; color:var(--muted-text); font-size:9px; font-variant-numeric:tabular-nums; }
.volume-control output { text-align:right; }
.volume-control input { width:100%; height:4px; appearance:none; border:0; border-radius:4px; outline:0; background:linear-gradient(to right,var(--accent) 0 calc(var(--volume) * 100%),color-mix(in srgb,var(--muted-text) 30%,transparent) calc(var(--volume) * 100%) 100%); cursor:pointer; }
.volume-control input::-webkit-slider-thumb { width:10px; height:10px; appearance:none; background:var(--accent); border:2px solid var(--panel-bg); border-radius:4px; box-shadow:0 1px 4px var(--shadow); }
.volume-control input::-moz-range-thumb { width:8px; height:8px; background:var(--accent); border:2px solid var(--panel-bg); border-radius:4px; }
.lyric-pane { display:flex; flex-direction:column; padding:22px 34px 16px; }
.lyric-pane>header { display:grid; justify-items:center; gap:4px; padding-bottom:10px; color:var(--muted-text); font-size:9px; }
.lyric-pane>header strong { max-width:100%; overflow:hidden; color:color-mix(in srgb,var(--panel-text) 68%,transparent); text-overflow:ellipsis; white-space:nowrap; font-size:11px; font-weight:600; }
.lyrics { display:flex; flex:1; flex-direction:column; align-items:center; justify-content:center; gap:17px; min-height:0; overflow:hidden; text-align:center; }
.lyrics p { display:grid; gap:4px; max-width:100%; margin:0; color:color-mix(in srgb,var(--muted-text) 56%,transparent); font-size:13px; line-height:1.35; transition:color .24s ease,transform .24s ease,opacity .24s ease; }
.lyrics p span,.lyrics p small { overflow-wrap:anywhere; }
.lyrics p small { color:inherit; font-size:10px; font-weight:500; }
.lyrics p.past { color:color-mix(in srgb,var(--muted-text) 38%,transparent); }
.lyrics p.active { color:var(--panel-text); font-size:20px; font-weight:800; transform:scale(1.03); }
.lyrics p.active small { color:color-mix(in srgb,var(--panel-text) 78%,transparent); font-size:11px; }
.lyrics .empty { color:var(--panel-text); font-size:16px; }
.lyrics .empty small { color:var(--muted-text); font-size:11px; }
.lyric-pane>footer { display:flex; align-items:center; justify-content:space-between; padding-top:12px; color:color-mix(in srgb,var(--muted-text) 64%,transparent); border-top:1px solid color-mix(in srgb,var(--border) 46%,transparent); font-size:8px; font-weight:650; letter-spacing:.08em; }
.lyric-pane>footer b { font-size:8px; font-weight:550; letter-spacing:0; }
.queue-pane { display:flex; flex-direction:column; }
.queue-pane>header { display:flex; align-items:center; justify-content:space-between; min-height:58px; padding:10px 12px; border-bottom:1px solid color-mix(in srgb,var(--border) 68%,transparent); }
.queue-pane>header div { display:grid; gap:3px; }
.queue-pane>header span { color:var(--muted-text); font-size:8px; letter-spacing:.08em; }
.queue-pane>header strong { font-size:14px; }
.queue-pane>header>b { color:var(--muted-text); font-size:9px; font-weight:600; }
.queue-viewport { position:relative; flex:1; min-height:0; overflow:hidden; }
.queue-list { height:100%; min-height:0; padding:5px; overflow-y:auto; }
.queue-list>button { display:grid; grid-template-columns:34px minmax(0,1fr) 24px; align-items:center; gap:8px; width:100%; min-height:46px; padding:5px; color:var(--panel-text); background:transparent; border:1px solid transparent; border-radius:4px; text-align:left; }
.queue-list>button:hover { background:color-mix(in srgb,var(--surface-hover) 72%,transparent); }
.queue-list>button.active { background:color-mix(in srgb,var(--surface-selected) 82%,transparent); border-color:color-mix(in srgb,var(--accent) 24%,var(--border)); }
.queue-list img { display:block; width:34px; height:34px; object-fit:cover; border-radius:4px; }
.queue-copy { display:grid; gap:3px; min-width:0; }
.queue-copy strong,.queue-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.queue-copy strong { font-size:10px; }
.queue-copy small { color:var(--muted-text); font-size:8px; }
.track-number { color:color-mix(in srgb,var(--muted-text) 68%,transparent); font:700 8px ui-monospace,monospace; text-align:center; }
.queue-meter { display:flex; align-items:end; justify-content:center; gap:2px; height:14px; color:var(--accent); }
.queue-meter i { width:2px; height:12px; background:currentColor; border-radius:2px; animation:queue-level .8s ease-in-out infinite alternate; }
.queue-meter i:nth-child(2) { height:8px; animation-delay:-.4s; }
.queue-meter i:nth-child(3) { height:5px; animation-delay:-.2s; }
.queue-meter:not(.playing) i { animation:none; transform:scaleY(.25); transform-origin:bottom; }
.queue-pane>footer { display:flex; align-items:center; justify-content:space-between; min-height:45px; padding:6px 8px 6px 12px; color:var(--muted-text); border-top:1px solid color-mix(in srgb,var(--border) 68%,transparent); font-size:8px; }
.queue-pane>footer div { display:flex; gap:4px; }
.queue-pane>footer button { width:28px; height:28px; font-size:15px; }
.queue-pane>footer button:disabled { opacity:.36; cursor:not-allowed; }
.queue-page-next-enter-active,.queue-page-next-leave-active,.queue-page-previous-enter-active,.queue-page-previous-leave-active { transition:opacity .2s ease,transform .26s cubic-bezier(.22,1,.36,1),filter .2s ease; }
.queue-page-next-enter-from { opacity:0; filter:blur(2px); transform:translateX(18px); }
.queue-page-next-leave-to { opacity:0; filter:blur(2px); transform:translateX(-12px); }
.queue-page-previous-enter-from { opacity:0; filter:blur(2px); transform:translateX(-18px); }
.queue-page-previous-leave-to { opacity:0; filter:blur(2px); transform:translateX(12px); }
.track-change-enter-active,.track-change-leave-active { transition:opacity .18s ease,transform .22s cubic-bezier(.22,1,.36,1); }
.track-change-enter-from { opacity:0; transform:translateY(7px); }
.track-change-leave-to { opacity:0; transform:translateY(-5px); }
@keyframes cover-spin { to { transform:rotate(360deg); } }
@keyframes queue-level { from { transform:scaleY(.25); } to { transform:scaleY(1); } }
@media (max-width:960px) { .music-dialog { grid-template-columns:220px minmax(320px,1fr); }.queue-pane { grid-column:1/-1; display:grid; grid-template-columns:150px minmax(0,1fr) 110px; min-height:132px; max-height:170px; }.queue-pane>header { border-right:1px solid var(--border); border-bottom:0; }.queue-list { display:flex; overflow-x:auto; overflow-y:hidden; }.queue-list>button { flex:0 0 210px; }.queue-pane>footer { border-top:0; border-left:1px solid var(--border); } }
@media (max-width:700px) { :global(.music-player-panel) { height:calc(100dvh - 24px); }.music-dialog { display:flex; flex-direction:column; overflow-y:auto; }.now-pane { display:grid; grid-template-columns:112px minmax(0,1fr); align-items:center; gap:0 14px; padding:14px; }.track-visual { grid-row:1/5; grid-template-columns:112px; }.cover-wrap { grid-row:1; }.track-heading,.track-visual>strong,.track-visual>small { grid-column:2; display:none; }.meter,.progress,.transport { grid-column:2; margin-block:5px; }.lyric-pane { flex:0 0 330px; padding:16px; }.lyrics { gap:11px; }.lyrics p { font-size:11px; }.lyrics p.active { font-size:16px; }.queue-pane { display:flex; flex:0 0 280px; width:auto; min-height:280px; max-height:none; }.queue-pane>header { border-right:0; border-bottom:1px solid var(--border); }.queue-list { display:block; overflow-y:auto; }.queue-list>button { width:100%; }.queue-pane>footer { border-top:1px solid var(--border); border-left:0; } }
@media (prefers-reduced-motion:reduce) { .track-change-enter-active,.track-change-leave-active,.queue-page-next-enter-active,.queue-page-next-leave-active,.queue-page-previous-enter-active,.queue-page-previous-leave-active { transition:none; }.cover-loading::after,.queue-meter i { animation:none; } }
</style>
