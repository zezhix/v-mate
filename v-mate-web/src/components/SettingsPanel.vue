<!-- src/components/SettingsPanel.vue -->
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'live' },
  scriptText: { type: String, default: '' },
})

const emit = defineEmits(['close', 'update:mode', 'confirm'])

const draft = ref(props.scriptText)

watch(
  () => props.scriptText,
  (val) => {
    draft.value = val
  }
)

function onConfirm() {
  emit('confirm', draft.value)
  emit('close')
}

function onDocumentMousedown(e) {
  if (!props.open) return
  if (e.target.closest && e.target.closest('[data-settings-trigger]')) return
  const panel = document.querySelector('.settings-panel')
  if (panel && !panel.contains(e.target)) emit('close')
}

function onDocumentKeydown(e) {
  if (!props.open) return
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMousedown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div v-if="open" class="settings-panel">
    <div class="mode-switch" role="tablist" aria-label="展示模式">
      <button
        class="mode-btn"
        :class="{ 'is-active': mode === 'live' }"
        type="button"
        @click="emit('update:mode', 'live')"
      >口播模式</button>
      <button
        class="mode-btn"
        :class="{ 'is-active': mode === 'chat' }"
        type="button"
        @click="emit('update:mode', 'chat')"
      >对话模式</button>
    </div>

    <label class="script-label" for="script-input">口播内容</label>
    <textarea
      id="script-input"
      v-model="draft"
      class="script-input"
      rows="8"
      placeholder="每行一句，确认后生效"
    ></textarea>

    <button class="confirm-btn" type="button" @click="onConfirm">确认</button>
  </div>
</template>

<style scoped>
.settings-panel {
  position: absolute;
  top: 64px;
  right: 20px;
  z-index: 20;
  width: 320px;
  padding: 16px;
  border-radius: 14px;
  background: rgba(20, 20, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.mode-switch {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
}

.mode-btn {
  flex: 1;
  padding: 7px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.mode-btn.is-active {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.12);
}

.script-label {
  display: block;
  margin: 14px 0 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.script-input {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  resize: vertical;
  font-family: inherit;
}

.script-input:focus {
  outline: none;
  border-color: rgba(140, 160, 255, 0.5);
}

.confirm-btn {
  width: 100%;
  margin-top: 12px;
  padding: 9px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(120, 140, 255, 0.28);
  border: 1px solid rgba(140, 160, 255, 0.4);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.confirm-btn:hover {
  background: rgba(120, 140, 255, 0.42);
}
</style>
