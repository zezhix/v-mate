<!-- src/components/TopBar.vue -->
<script setup>
defineProps({
  open: { type: Boolean, default: false },
  playing: { type: Boolean, default: false },
})
defineEmits(['toggle', 'replay', 'toggle-play'])
</script>

<template>
  <header class="top-bar">
    <button
      class="play-btn icon-btn"
      type="button"
      :aria-label="playing ? '暂停' : '播放'"
      @click="$emit('toggle-play')"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <template v-if="playing">
          <line x1="9.5" y1="6" x2="9.5" y2="18" />
          <line x1="14.5" y1="6" x2="14.5" y2="18" />
        </template>
        <polygon v-else points="9,6 18,12 9,18" fill="currentColor" />
      </svg>
    </button>

    <button
      class="replay-btn icon-btn"
      type="button"
      aria-label="重新播放"
      @click="$emit('replay')"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3v6h6" />
        <path d="M3.5 13a8.5 8.5 0 1 0 2.5-6.1L3 9.5" />
      </svg>
    </button>

    <button
      class="gear icon-btn"
      :class="{ 'is-open': open }"
      type="button"
      aria-label="设置"
      data-settings-trigger
      @click="$emit('toggle')"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3.2" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"
        />
      </svg>
    </button>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.2s, background 0.2s;
}

.icon-btn:hover,
.gear.is-open {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}
</style>
