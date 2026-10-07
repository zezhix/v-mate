<!-- src/components/DigitalHumanVideo.vue -->
<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  src: { type: String, required: true },
  muted: { type: Boolean, default: true },
  loop: { type: Boolean, default: true },   // 兜底视频循环；段视频关闭以触发 ended
  paused: { type: Boolean, default: false },
  replayTick: { type: Number, default: 0 }, // 递增触发从头重播（src 未变也要 seek 0）
})

const emit = defineEmits(['update:currentTime', 'error', 'ended'])

const failed = ref(false)
const videoRef = ref(null)

// 切换视频源（兜底 ↔ 段）后允许重新加载，不留失败残影
watch(() => props.src, () => {
  failed.value = false
  // 暂停态换段兜底：新 src 载入后仍停住（autoplay 属性已随 paused 移除，此处双保险）
  if (props.paused) safePause()
})

watch(() => props.replayTick, () => {
  const el = videoRef.value
  if (!el) return
  try { el.currentTime = 0 } catch { /* 元素尚未可 seek 时忽略 */ }
  safePlay()
})

watch(() => props.paused, (val) => {
  if (val) safePause()
  else safePlay()
})

function safePlay() {
  try {
    const p = videoRef.value?.play?.()
    if (p && typeof p.catch === 'function') p.catch(() => {})   // 自动播放被浏览器拒绝时静默
  } catch { /* 元素不存在或环境不支持播放时忽略 */ }
}

function safePause() {
  try { videoRef.value?.pause?.() } catch { /* 同上 */ }
}

function onTimeUpdate(e) {
  emit('update:currentTime', e.target.currentTime ?? 0)
}

function onError() {
  failed.value = true
  emit('error')
}
</script>

<template>
  <div class="video-wrap">
    <video
      v-if="!failed"
      ref="videoRef"
      :src="src"
      :muted="muted"
      :loop="loop"
      :autoplay="!paused"
      playsinline
      @timeupdate="onTimeUpdate"
      @ended="emit('ended')"
      @error="onError"
    />
    <p v-else class="video-error">视频加载失败</p>

    <!-- 左缘颜色过渡：视频渐隐进页面背景色，消除交界处的分裂感 -->
    <div class="edge-fade" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.video-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
}

video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.video-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: rgba(255, 255, 255, 0.35);
  font-size: 14px;
}

/* 左缘 120px 渐变带：从页面背景色渐变到透明，把视频像素无缝融进背景 */
.edge-fade {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 120px;
  background: linear-gradient(to right, #0a0a0f 0%, rgba(10, 10, 15, 0) 100%);
  pointer-events: none;
  z-index: 1;
}
</style>
