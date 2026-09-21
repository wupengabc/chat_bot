<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon, VolumeIcon } from './MusicIcons'
import MusicScrollText from './MusicScrollText.vue'
import { useMusicPlayerStore } from '../stores/musicPlayer'

const props = defineProps<{ pipWindow: Window | null }>()
const player = useMusicPlayerStore()

const target = computed(() => props.pipWindow?.document.body ?? null)
const progressStyle = computed(() => ({ '--music-progress': `${Math.min(100, Math.max(0, player.progress * 100))}%` }))
const volumeStyle = computed(() => ({ '--music-volume': `${Math.round(player.volume * 100)}%` }))
const ambientStyle = computed(() => ({ backgroundImage: `url(${JSON.stringify(player.playerCover)})` }))
const mvVideo = ref<HTMLVideoElement | null>(null)
const mvSource = ref('')
const mvOffset = ref(0)
const mvOffsetStorageKey = 'bangxi-music-mv-offsets'
const mvUrls = computed(() => player.mv?.downurl ? [player.mv.downurl, ...player.mv.backupdownurl] : [])
const mvOffsetText = computed(() => `${mvOffset.value > 0 ? '+' : ''}${mvOffset.value.toFixed(1)}s`)
const hasLyric = computed(() => Boolean(player.lyrics.length && player.currentLyricIndex >= 0))
const currentLyricTranslation = computed(() => player.lyrics[player.currentLyricIndex]?.translation.trim() || '')
const hasLyricTranslation = computed(() => Boolean(currentLyricTranslation.value && currentLyricTranslation.value !== player.currentLyric))
const formatTime = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`

function seekFromEvent(event: Event) {
  player.seek(Number((event.target as HTMLInputElement).value))
}

function changeVolume(event: Event) {
  player.setVolume(Number((event.target as HTMLInputElement).value))
}

function readMvOffsets(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(mvOffsetStorageKey) || '{}') as Record<string, number> } catch { return {} }
}

function saveMvOffset(offset: number) {
  const mvhash = player.mv?.mvhash
  if (!mvhash) return
  try {
    const offsets = readMvOffsets()
    if (Math.abs(offset) < .05) delete offsets[mvhash]
    else offsets[mvhash] = offset
    localStorage.setItem(mvOffsetStorageKey, JSON.stringify(offsets))
  } catch { /* 本地存储不可用时仅保留本次校准。 */ }
}

function changeMvOffset(delta: number) {
  mvOffset.value = Math.max(-5, Math.min(5, Math.round((mvOffset.value + delta) * 10) / 10))
  saveMvOffset(mvOffset.value)
  syncMvTime(mvVideo.value, true)
}

function resetMvOffset() {
  mvOffset.value = 0
  saveMvOffset(0)
  syncMvTime(mvVideo.value, true)
}

function syncMvTime(video = mvVideo.value, force = false) {
  if (!video || !mvSource.value || !player.duration) return
  const targetTime = player.currentTime + mvOffset.value
  const audioTime = Math.max(0, Math.min(targetTime, video.duration || player.duration))
  if (force || Math.abs(video.currentTime - audioTime) > .08) {
    try { video.currentTime = audioTime } catch { /* MV 元数据尚未准备好时下一次同步。 */ }
  }
}

async function syncMvPlayback() {
  const video = mvVideo.value
  if (!video || !mvSource.value) return
  video.muted = true
  video.volume = 0
  syncMvTime(video, true)
  if (player.playing) {
    try { await video.play() } catch { /* 浏览器可能暂缓自动播放，稍后状态变化时重试。 */ }
  } else video.pause()
}

function useNextBackupMv() {
  const urls = mvUrls.value
  const index = urls.indexOf(mvSource.value)
  const nextUrl = urls[index + 1]
  mvSource.value = nextUrl || ''
}

watch(() => player.mv?.mvhash, mvhash => {
  const saved = mvhash ? Number(readMvOffsets()[mvhash]) : 0
  mvOffset.value = Number.isFinite(saved) ? Math.max(-5, Math.min(5, saved)) : 0
}, { immediate: true })

watch(() => [player.mv?.mvhash, player.mv?.downurl], () => {
  mvSource.value = mvUrls.value[0] || ''
}, { immediate: true })

watch([mvSource, () => player.playing], async () => {
  await nextTick()
  await syncMvPlayback()
}, { immediate: true })

watch(() => player.currentTime, () => syncMvTime(), { flush: 'post' })
</script>

<template>
  <Teleport v-if="target" :to="target">
    <section class="music-pip" :style="{ ...progressStyle, '--ambient-cover': ambientStyle.backgroundImage }" :data-playing="player.playing" :data-has-mv="Boolean(mvSource)" aria-label="音乐迷你播放器">
      <div class="music-pip-ambient" aria-hidden="true">
        <video v-if="mvSource" :key="mvSource" ref="mvVideo" class="music-pip-video" :src="mvSource" :poster="player.playerCover" muted playsinline preload="auto" disablepictureinpicture @loadeddata="syncMvPlayback" @error="useNextBackupMv" />
      </div>
      <span v-if="player.trackLoading" class="music-pip-loading" aria-hidden="true" />
      <div class="music-pip-controls music-pip-controls-inline">
        <button class="music-pip-step" aria-label="上一首" type="button" @click="player.previous"><SkipForwardIcon /></button>
        <button class="music-pip-play" :aria-label="player.playing ? '暂停' : '播放'" type="button" @click="player.toggle">
          <PauseIcon v-if="player.playing" />
          <PlayIcon v-else />
        </button>
        <button class="music-pip-step" aria-label="下一首" type="button" @click="player.next"><SkipBackIcon /></button>
      </div>
      <div class="music-pip-shell">
        <div class="music-pip-info">
          <div class="music-pip-track-info">
            <div class="music-pip-label-row">
              <span class="music-pip-label">NOW PLAYING</span>
              <span class="music-pip-eq" aria-hidden="true"><i /><i /><i /></span>
            </div>
            <strong class="music-pip-title">{{ player.title }}</strong>
            <MusicScrollText class="music-pip-artist" :text="player.artist" :speed="38" />
          </div>
          <div v-if="hasLyric" class="music-pip-lyrics" aria-live="polite">
            <MusicScrollText class="music-pip-lyric" :text="player.currentLyric" :speed="36" />
            <MusicScrollText v-if="hasLyricTranslation" class="music-pip-lyric-translation" :text="currentLyricTranslation" :speed="36" />
          </div>
          <MusicScrollText v-else class="music-pip-playlist" :text="player.playlistName" :speed="36" />
        </div>

        <div class="music-pip-playback">
          <span>{{ formatTime(player.currentTime) }}</span>
          <label class="music-pip-seek" aria-label="播放进度">
            <input :value="player.currentTime" :disabled="!player.duration" :max="player.duration || 0" aria-label="播放进度" min="0" step="0.01" type="range" @input="seekFromEvent">
          </label>
          <span>{{ formatTime(player.duration) }}</span>
          <div v-if="mvSource" class="music-pip-mv-sync" aria-label="MV 音画同步">
            <button aria-label="MV 画面后退 0.1 秒" title="MV 画面后退 0.1 秒" type="button" @click="changeMvOffset(-.1)">MV-</button>
            <button aria-label="重置 MV 音画偏移" title="MV 音画偏移，点击归零" type="button" @click="resetMvOffset">{{ mvOffsetText }}</button>
            <button aria-label="MV 画面前进 0.1 秒" title="MV 画面前进 0.1 秒" type="button" @click="changeMvOffset(.1)">MV+</button>
          </div>
          <label class="music-pip-volume" :style="volumeStyle" title="音量">
            <VolumeIcon />
            <input :value="player.volume" aria-label="音量" max="1" min="0" step="0.01" type="range" @input="changeVolume">
          </label>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style>
html,body { width:100%; height:100%; margin:0; overflow:hidden; }
body.music-pip-document { width:100%; min-width:0 !important; max-width:100%; }
.music-pip,.music-pip *,.music-pip *::before,.music-pip *::after { box-sizing:border-box; }
.music-pip { position:relative; display:flex; flex-direction:column; width:100%; min-width:0; height:100%; min-height:0; overflow:hidden; color:#f5f9ff; background:#07111d; font-family:sans-serif; container:pip / size; isolation:isolate; }
.music-pip-ambient { position:absolute; inset:0; overflow:hidden; background-image:var(--ambient-cover); background-position:center; background-size:cover; }
.music-pip-video { position:absolute; z-index:0; inset:0; display:block; width:100%; height:100%; object-fit:cover; }
.music-pip-ambient::before { content:""; position:absolute; z-index:1; inset:0; background:linear-gradient(180deg,rgb(7 17 29 / .3),rgb(7 17 29 / .12) 34%,rgb(7 17 29 / .72) 72%,rgb(7 17 29 / .9)),linear-gradient(90deg,rgb(7 17 29 / .24),transparent 38%,rgb(7 17 29 / .3)); pointer-events:none; }
.music-pip-ambient::after { content:""; position:absolute; z-index:2; inset:0; background:radial-gradient(circle at 82% 22%,rgb(255 255 255 / .16),transparent 34%); pointer-events:none; }
.music-pip-shell { position:relative; z-index:2; }
.music-pip-controls button:focus-visible,.music-pip-seek input:focus-visible,.music-pip-volume input:focus-visible { outline:2px solid #ffffff; outline-offset:2px; }
.music-pip-shell { display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr) 22px; align-items:center; justify-items:center; flex:1 1 auto; width:100%; min-width:0; max-width:100%; height:100%; min-height:0; overflow:hidden; padding:10px; }
.music-pip-loading { position:absolute; z-index:4; inset:0; display:grid; place-items:center; background:rgb(7 17 29 / .48); }
.music-pip-loading::after { width:21px; height:21px; border:2px solid rgb(255 255 255 / .18); border-top-color:var(--accent); border-radius:4px; content:""; animation:music-pip-spin .72s linear infinite; }
.music-pip-info { display:grid; grid-column:1; grid-row:1; grid-template-rows:auto auto; align-content:start; justify-items:center; align-self:start; width:100%; max-width:100%; min-width:0; overflow:visible; padding-block:6px 0; text-align:center; }
.music-pip-track-info { display:grid; justify-items:center; width:100%; max-width:100%; min-width:0; overflow:hidden; }
.music-pip-label-row { display:flex; align-items:center; justify-content:center; max-width:100%; gap:6px; }
.music-pip-label { color:var(--accent); font-size:6px; font-weight:900; letter-spacing:.18em; text-shadow:0 0 9px color-mix(in srgb,var(--accent) 36%,transparent); }
.music-pip-eq { display:inline-grid; grid-template-columns:repeat(3,3px); align-items:end; gap:2px; height:8px; }
.music-pip-eq i { display:block; width:3px; height:7px; background:var(--accent); border-radius:1px; transform-origin:bottom; animation:music-pip-eq .72s ease-in-out infinite alternate; }
.music-pip-eq i:nth-child(2) { animation-delay:.16s; }
.music-pip-eq i:nth-child(3) { animation-delay:.31s; }
.music-pip[data-playing="false"] .music-pip-eq i { animation-play-state:paused; transform:scaleY(.34); }
.music-pip-title { display:-webkit-box; margin-top:3px; overflow:hidden; color:#ffffff; font-size:clamp(13px,5vh,16px); font-weight:820; line-height:1.28; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:2; text-shadow:0 1px 2px rgb(0 0 0 / .32); }
.music-pip-artist { margin-top:3px; color:rgb(226 237 255 / .64); font-size:clamp(8px,3vh,10px); line-height:1.2; }
.music-pip-lyrics { display:grid; grid-template-rows:auto auto; align-content:start; justify-items:center; width:100%; max-width:100%; min-width:0; overflow:visible; padding:0; }
.music-pip-lyric,.music-pip-playlist { margin-top:5px; color:#ffffff; font-size:clamp(12px,4vh,14px); font-weight:800; line-height:1.22; text-shadow:0 2px 5px rgb(0 0 0 / .62),0 0 12px rgb(0 0 0 / .34); }
.music-pip-lyric-translation { margin-top:3px; color:rgb(248 251 255 / .86); font-size:clamp(10px,3.2vh,12px); font-weight:750; line-height:1.22; text-shadow:0 2px 4px rgb(0 0 0 / .58); }
.music-pip[data-has-mv="true"] .music-pip-info { grid-template-rows:auto minmax(0,1fr); align-self:stretch; padding-bottom:8px; }
.music-pip[data-has-mv="true"] .music-pip-lyrics { align-self:end; justify-self:center; width:min(100%,620px); padding:0; }
.music-pip[data-has-mv="true"] .music-pip-lyric { font-size:clamp(13px,4.8cqh,18px); }
.music-pip[data-has-mv="true"] .music-pip-lyric-translation { font-size:clamp(11px,3.6cqh,15px); }
.music-pip-playback { display:grid; grid-column:1; grid-row:2; grid-template-columns:max-content minmax(0,1fr) max-content auto auto; align-items:center; gap:6px; align-self:stretch; width:100%; max-width:100%; min-width:0; padding-bottom:0; }
.music-pip-playback>span { color:rgb(228 238 255 / .62); font:750 8px/1 sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap; }
.music-pip-mv-sync { display:flex; align-items:center; gap:3px; min-width:0; }
.music-pip-mv-sync button { height:16px; min-width:0; padding:0 4px; color:rgb(244 248 255 / .84); background:rgb(7 17 29 / .34); border:1px solid rgb(255 255 255 / .18); border-radius:4px; font:750 7px/1 sans-serif; cursor:pointer; }
.music-pip-mv-sync button:nth-child(2) { min-width:34px; font-variant-numeric:tabular-nums; }
.music-pip-mv-sync button:hover { color:#ffffff; background:rgb(255 255 255 / .16); }
.music-pip-seek { display:block; min-width:0; height:11px; cursor:pointer; }
.music-pip-seek input { display:block; width:100%; height:11px; margin:0; appearance:none; background:transparent; cursor:pointer; outline:0; }
.music-pip-seek input::-webkit-slider-runnable-track { height:3px; margin-top:0; background:linear-gradient(to right,#ffffff 0 var(--music-progress),rgb(255 255 255 / .22) var(--music-progress) 100%); border-radius:4px; }
.music-pip-seek input::-webkit-slider-thumb { width:9px; height:9px; margin-top:-3px; appearance:none; background:#ffffff; border:0; border-radius:50%; box-shadow:0 1px 5px rgb(0 0 0 / .48); opacity:1; transition:transform .16s ease; }
.music-pip-seek input::-moz-range-track { height:3px; background:linear-gradient(to right,#ffffff 0 var(--music-progress),rgb(255 255 255 / .22) var(--music-progress) 100%); border-radius:4px; }
.music-pip-seek input::-moz-range-thumb { width:9px; height:9px; background:#ffffff; border:0; border-radius:50%; box-shadow:0 1px 5px rgb(0 0 0 / .48); }
.music-pip-seek:hover input::-webkit-slider-thumb,.music-pip-seek:focus-within input::-webkit-slider-thumb,.music-pip-seek input:active::-webkit-slider-thumb { transform:scale(1.15); }
.music-pip-volume { display:grid; grid-template-columns:13px minmax(0,1fr); align-items:center; gap:5px; width:74px; min-width:0; color:rgb(228 238 255 / .7); }
.music-pip-volume svg { width:13px; height:13px; }
.music-pip-volume input { width:100%; height:14px; margin:0; appearance:none; background:transparent; cursor:pointer; outline:0; }
.music-pip-volume input::-webkit-slider-runnable-track { height:4px; margin-top:0; background:linear-gradient(to right,#ffffff 0 var(--music-volume),rgb(255 255 255 / .2) var(--music-volume) 100%); border-radius:4px; }
.music-pip-volume input::-webkit-slider-thumb { width:10px; height:10px; margin-top:-3px; appearance:none; background:#ffffff; border:0; border-radius:50%; box-shadow:0 1px 5px rgb(0 0 0 / .45); }
.music-pip-volume input::-moz-range-track { height:4px; background:linear-gradient(to right,#ffffff 0 var(--music-volume),rgb(255 255 255 / .2) var(--music-volume) 100%); border-radius:4px; }
.music-pip-volume input::-moz-range-thumb { width:10px; height:10px; background:#ffffff; border:0; border-radius:50%; }
.music-pip-controls { display:flex; align-items:center; }
.music-pip-controls button { display:grid; place-items:center; padding:0; color:#f4f9ff; cursor:pointer; pointer-events:auto; transition:background-color .16s ease,border-color .16s ease,color .16s ease,transform .16s ease; }
.music-pip-controls-inline { position:absolute; z-index:5; inset:0; justify-content:center; gap:5px; visibility:hidden; background:rgb(7 17 29 / .18); opacity:0; pointer-events:none; transition:opacity .18s ease,visibility .18s ease; }
.music-pip:hover .music-pip-controls-inline { visibility:visible; opacity:1; }
.music-pip-controls-inline button { width:29px; height:29px; background:rgb(255 255 255 / .09); border:1px solid rgb(255 255 255 / .15); border-radius:50%; }
.music-pip-controls-inline button:hover { background:rgb(255 255 255 / .17); transform:translateY(-1px); }
.music-pip-controls-inline svg { width:12px; height:12px; }
.music-pip-controls-inline .music-pip-play { width:37px; height:37px; color:#06111d; background:#ffffff; border-color:#ffffff; box-shadow:0 7px 16px rgb(0 0 0 / .3); }
.music-pip-controls-inline .music-pip-play svg { width:15px; height:15px; }
@media (max-height:150px) {
  .music-pip-label-row,.music-pip-lyrics,.music-pip-playlist,.music-pip-volume,.music-pip-mv-sync { display:none; }
  .music-pip-shell { grid-template-rows:minmax(34px,1fr) 16px; gap:3px; padding:8px 10px 10px; }
  .music-pip-title { margin-top:1px; font-size:12px; }
  .music-pip-artist { margin-top:2px; font-size:8px; }
  .music-pip-controls-inline { gap:3px; }
  .music-pip-controls-inline button { width:26px; height:26px; }
  .music-pip-controls-inline .music-pip-play { width:33px; height:33px; }
  .music-pip-playback { gap:4px; }
}
@media (max-height:150px),(max-width:230px) {
  .music-pip-playback>span { display:none; }
  .music-pip-volume { display:none; }
}
@container pip (min-width:560px) {
  .music-pip-shell { grid-template-rows:minmax(0,1fr) 30px; gap:10px; padding:clamp(16px,4cqw,32px); }
  .music-pip-info { max-width:min(88cqw,720px); }
  .music-pip-label { font-size:9px; }
  .music-pip-title { margin-top:8px; font-size:clamp(19px,4.6cqh,34px); line-height:1.16; }
  .music-pip-artist { margin-top:4px; font-size:clamp(12px,2cqh,16px); }
  .music-pip-lyrics { margin-top:clamp(10px,3cqh,22px); }
  .music-pip-lyric,.music-pip-playlist { font-size:clamp(15px,3.2cqh,25px); }
  .music-pip-lyric-translation { font-size:clamp(12px,2.3cqh,19px); }
  .music-pip-controls-inline { gap:clamp(10px,2cqw,18px); }
  .music-pip-controls-inline button { width:clamp(40px,7cqh,54px); height:clamp(40px,7cqh,54px); }
  .music-pip-controls-inline .music-pip-play { width:clamp(52px,9.5cqh,70px); height:clamp(52px,9.5cqh,70px); }
  .music-pip-playback { gap:10px; }
  .music-pip-playback>span { font-size:10px; }
  .music-pip-volume { width:96px; }
}
@container pip (max-width:380px) {
  .music-pip-shell { padding:10px; }
  .music-pip-playback { grid-template-columns:max-content minmax(0,1fr) max-content auto; }
  .music-pip-volume { display:none; }
}
@keyframes music-pip-spin { to { transform:rotate(360deg); } }
@keyframes music-pip-eq { from { transform:scaleY(.32); opacity:.72; } to { transform:scaleY(1); opacity:1; } }
@media (prefers-reduced-motion:reduce) { .music-pip-loading::after,.music-pip-eq i { animation:none; } .music-pip-controls button,.music-pip-seek input::-webkit-slider-thumb { transition:none; } .music-pip-controls button:hover { transform:none; } }
</style>
