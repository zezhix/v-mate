<!-- src/App.vue -->
<script setup>
import { ref, computed } from 'vue'
import TopBar from './components/TopBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import DigitalHumanVideo from './components/DigitalHumanVideo.vue'
import LiveLyricsMode from './components/LiveLyricsMode.vue'
import ChatMode from './components/ChatMode.vue'
import { parseScriptText, scriptToText } from './utils/timeline.js'
import { loadJSON, saveJSON } from './utils/storage.js'
import defaultScript from './mock/script.json'
import defaultMessages from './mock/messages.json'
import videoUrl from '../vedio.mp4?url'
import { useBroadcastJob } from './composables/useBroadcastJob'

const MODE_KEY = 'vmate.mode'
const SCRIPT_KEY = 'vmate.script'

// 在 setup 期同步恢复持久化状态：首帧即为最终模式，避免先闪一下默认口播再切换
const savedMode = loadJSON(MODE_KEY, 'live')
const savedScript = loadJSON(SCRIPT_KEY, null)

const panelOpen = ref(false)
const playing = ref(false)  // 默认暂停：点播放（用户手势）后带声播放，规避自动播放拦截
const mode = ref(savedMode === 'chat' ? 'chat' : 'live')
const script = ref(
  Array.isArray(savedScript) && savedScript.length ? savedScript : defaultScript
)
const currentTime = ref(0)
const videoFailed = ref(false)
// 开屏暂停期间保持静音；点播放/重播（用户手势）后解除
const muted = ref(true)
const replayTick = ref(0)   // 递增通知视频从头重播（src 未变时也必须 seek 0）

const fallbackTimes = defaultScript.map((item) => item.time)

const broadcast = useBroadcastJob({ fallbackSrc: videoUrl })
broadcast.restore()   // 页面加载：恢复最近任务（进度/歌词/已生成段同源）；失败则维持 mock 首屏
const {
  videoSrc: broadcastSrc, script: broadcastScript, lyricTime: broadcastLyricTime,
  progress: broadcastProgress, showProgress, active: broadcastActive,
  error: broadcastError, start: startBroadcast, stop: stopBroadcast,
  onEndedVideo, onSegmentError, onTimeUpdate,
} = broadcast

const videoSrc = computed(() => broadcastSrc.value)
const isFallbackVideo = computed(() => broadcastSrc.value === videoUrl)
const confirmError = ref(null)
let confirmErrorTimer = null

// 任务激活时用真实时间轴，否则沿用 mock（首屏与后端不可用时的回退）
const lyricScript = computed(() =>
  broadcastActive.value ? broadcastScript.value : script.value)
const lyricCurrentTime = computed(() =>
  broadcastActive.value ? broadcastLyricTime.value : currentTime.value)
const scriptText = computed(() =>
  broadcastActive.value
    ? broadcastScript.value.map((s) => s.text).join('\n')
    : scriptToText(script.value))

function onModeChange(next) {
  mode.value = next === 'chat' ? 'chat' : 'live'
  saveJSON(MODE_KEY, mode.value)
}

function togglePlay() {
  playing.value = !playing.value
  if (playing.value) {
    muted.value = false                    // 恢复播放由用户手势触发 → 带声
    broadcast.resumeReplayDelay()          // 恢复播放 → 重播延迟按剩余时长续排
  } else {
    broadcast.pauseReplayDelay()           // 暂停 → 挂起重播延迟，到期不切段
  }
}

function onReplay() {
  muted.value = false                      // 重播即带声
  playing.value = true
  currentTime.value = 0                    // 歌词（含无任务的 mock 台词）定位到第一句
  broadcast.replay()
  replayTick.value += 1                    // src 未变时也从头 seek
}

async function onConfirmScript(text) {
  const next = parseScriptText(text, fallbackTimes)
  if (!next.length) return
  confirmError.value = null
  clearTimeout(confirmErrorTimer)   // 手动重置同步作废自动清除，防旧计时器误清新错误
  // 本地立即生效：歌词/设置面板不等后端往返
  script.value = next
  saveJSON(SCRIPT_KEY, next)
  try {
    await startBroadcast(text)          // 后端接管：切分/TTS/渲染/SSE
  } catch (err) {
    // 后端不可用：本地已写入生效，停掉后台会话并提示（不回滚本地）
    stopBroadcast()
    confirmError.value = '口播服务不可用，已按本地时间轴生效'
    clearTimeout(confirmErrorTimer)
    confirmErrorTimer = setTimeout(() => { confirmError.value = null }, 4000)
  }
}

function onVideoTime(t) {
  currentTime.value = t
  onTimeUpdate(t)
}

function onVideoError() {
  if (!isFallbackVideo.value) {
    onSegmentError()          // 段视频 404/损坏 → 状态机跳段，不留错误页
    return
  }
  videoFailed.value = true
}
</script>

<template>
  <div class="layout">
    <TopBar
      :open="panelOpen"
      :playing="playing"
      @toggle="panelOpen = !panelOpen"
      @replay="onReplay"
      @toggle-play="togglePlay"
    />

    <main class="content-area">
      <div v-if="showProgress" class="progress-badge">
        口播生成中 {{ broadcastProgress.ready }}/{{ broadcastProgress.total }}
      </div>
      <p v-if="broadcastError" class="broadcast-error">{{ broadcastError }}</p>
      <p v-if="confirmError" class="confirm-error">{{ confirmError }}</p>
      <LiveLyricsMode
        v-if="mode === 'live'"
        :script="lyricScript"
        :current-time="lyricCurrentTime"
      />
      <ChatMode
        v-else
        :messages="defaultMessages"
        :current-time="currentTime"
      />
    </main>

    <aside class="video-area" :class="{ 'is-video-failed': videoFailed }">
      <DigitalHumanVideo
        :src="videoSrc"
        :muted="muted"
        :loop="isFallbackVideo"
        :paused="!playing"
        :replay-tick="replayTick"
        @update:current-time="onVideoTime"
        @ended="onEndedVideo"
        @error="onVideoError"
      />
    </aside>

    <SettingsPanel
      :open="panelOpen"
      :mode="mode"
      :script-text="scriptText"
      @close="panelOpen = false"
      @update:mode="onModeChange"
      @confirm="onConfirmScript"
    />
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 1fr minmax(480px, calc(34vw + 80px));
  grid-template-rows: 40px 1fr;
  gap: 0;
  height: 100vh;
  padding: 0;
  position: relative;
}

/* 顶栏横跨两栏：齿轮悬浮在页面右上角（视频之上），透明区域不拦截视频交互 */
.layout :deep(.top-bar) {
  grid-area: 1 / 1 / 2 / 3;
  padding: 20px 20px 0 0;
  position: relative;
  z-index: 10;
  pointer-events: none;
}

.layout :deep(.top-bar .icon-btn) {
  pointer-events: auto;
}

.content-area {
  grid-area: 2 / 1 / 3 / 2;
  position: relative;
  overflow: hidden;
  padding: 16px 20px 20px 20px;
}

/* 视频占满右侧整列并贴边满铺（上下右三边与窗口齐平），无卡片外观 */
.video-area {
  grid-area: 1 / 2 / 3 / 3;
  position: relative;
  overflow: hidden;
}

.progress-badge {
  position: absolute;
  top: 12px;
  left: 20px;
  z-index: 5;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(120, 140, 255, 0.18);
  border: 1px solid rgba(140, 160, 255, 0.35);
}

.broadcast-error {
  position: absolute;
  top: 46px;
  left: 20px;
  z-index: 5;
  margin: 0;
  font-size: 12px;
  color: rgba(255, 160, 140, 0.85);
}

/* 与 .broadcast-error 同轨错行堆叠：两者存在同显的边界场景（见报告），错行保证永不重叠 */
.confirm-error {
  position: absolute;
  top: 78px;
  left: 20px;
  z-index: 5;
  margin: 0;
  font-size: 12px;
  color: rgba(255, 160, 140, 0.85);
}
</style>
