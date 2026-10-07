<!-- src/components/LiveLyricsMode.vue -->
<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { findCurrentIndex } from '../utils/timeline.js'

const props = defineProps({
  script: { type: Array, default: () => [] },
  currentTime: { type: Number, default: 0 },
})

const times = computed(() => props.script.map((item) => item.time))
const currentIndex = computed(() => findCurrentIndex(times.value, props.currentTime))

const listEl = ref(null)

watch(currentIndex, async () => {
  await nextTick()
  const el = listEl.value?.children[currentIndex.value]
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})
</script>

<template>
  <div v-if="script.length" class="lyrics">
    <ul ref="listEl" class="lyric-list">
      <li
        v-for="(item, i) in script"
        :key="i"
        class="lyric-line"
        :class="{ 'is-current': i === currentIndex }"
      >{{ item.text }}</li>
    </ul>
  </div>
  <p v-else class="empty-state">暂无口播内容，请在设置中输入</p>
</template>

<style scoped>
.lyrics {
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyric-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

.lyric-list::-webkit-scrollbar {
  display: none;
}

.lyric-line {
  padding: 10px 24px;
  font-size: 20px;
  line-height: 1.6;
  text-align: center;
  color: rgba(255, 255, 255, 0.28);
  transition: color 0.4s ease, font-size 0.4s ease, opacity 0.4s ease;
}

.lyric-line.is-current {
  font-size: 32px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 0 24px rgba(120, 150, 255, 0.35);
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: rgba(255, 255, 255, 0.35);
  font-size: 14px;
}
</style>
