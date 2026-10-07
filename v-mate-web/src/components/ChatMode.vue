<!-- src/components/ChatMode.vue -->
<script setup>
import { computed, ref, watch, nextTick } from 'vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  currentTime: { type: Number, default: 0 },
})

const visible = computed(() =>
  props.messages.filter((m) => m.time <= props.currentTime)
)

const containerEl = ref(null)

watch(
  () => visible.value.length,
  async () => {
    await nextTick()
    const el = containerEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<template>
  <div v-if="messages.length" ref="containerEl" class="chat">
    <div
      v-for="(m, i) in visible"
      :key="i"
      class="msg"
      :class="m.role === 'user' ? 'msg-user' : 'msg-assistant'"
    >
      <span v-if="m.role !== 'user'" class="msg-avatar" aria-hidden="true"></span>
      <div class="msg-bubble">
        <span class="msg-text">{{ m.text }}</span>
      </div>
    </div>
  </div>
  <p v-else class="empty-state">暂无对话消息</p>
</template>

<style scoped>
.chat {
  height: 100%;
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scrollbar-width: none;
}

.chat::-webkit-scrollbar {
  display: none;
}

.msg {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  animation: fade-in 0.35s ease;
}

.msg-user {
  justify-content: flex-end;
}

.msg-assistant {
  justify-content: flex-start;
}

.msg-avatar {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(120, 150, 255, 0.5), rgba(180, 110, 255, 0.4));
}

.msg-bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.msg-user .msg-bubble {
  background: rgba(120, 140, 255, 0.18);
  border-color: rgba(140, 160, 255, 0.3);
  border-bottom-right-radius: 4px;
}

.msg-assistant .msg-bubble {
  border-bottom-left-radius: 4px;
}

.msg-text {
  font-size: 14px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.88);
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

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
