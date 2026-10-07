// src/utils/broadcast.js — 播放列表决策：纯函数、无 DOM，事件带 index 保证顺序

/**
 * 创建播放状态。playing === null 表示当前应显示兜底视频。
 * @param {number} total 任务总段数（切分时已定，创建任务响应即返回）
 */
export function createPlayerState(total) {
  return {
    total,
    nextIndex: 0,      // 等待/应播的段号
    ready: new Set(),
    failed: new Set(),
    done: false,
    playing: null,     // 正在播放的段号
  }
}

/**
 * 应用一条 SSE 事件（snapshot 由组合函数拆成多条后调用本函数）。
 * @returns {{state: object, action: object|null}}
 */
export function reduceEvent(state, event) {
  if (event.type === 'chunk_ready') {
    state.ready.add(event.index)
    if (state.playing === null && event.index === state.nextIndex) {
      return play(state, event.index)
    }
    if (state.playing !== null && event.index === state.playing + 1
        && !state.failed.has(event.index)) {
      return { state, action: { type: 'preload', index: event.index } }
    }
    return { state, action: null }
  }
  if (event.type === 'job_error') {
    state.failed.add(event.index)
    if (state.playing === null && event.index === state.nextIndex) {
      return seekForward(state, event.index + 1)   // 等的就是失败段 → 跳过
    }
    return { state, action: null }
  }
  if (event.type === 'job_done') {
    state.done = true
    if (state.playing !== null) return { state, action: null }
    if (state.nextIndex < state.total && state.ready.has(state.nextIndex)) {
      return play(state, state.nextIndex)
    }
    if (state.nextIndex >= state.total) {
      return { state, action: { type: 'play_fallback' } }  // 全部播完 → 底模，不回卷
    }
    return { state, action: null }
  }
  return { state, action: null }
}

/**
 * 当前段播放结束（仅段视频会触发；兜底视频 loop 不触发 ended）。
 * @returns {{state: object, action: object|null}}
 */
export function onEnded(state) {
  if (state.playing === null) return { state, action: null }
  return seekForward(state, state.playing + 1)
}

/**
 * 重播：回到第 0 段重新开始（跳过失败段；未就绪则兜底等待）。
 * @returns {{state: object, action: object|null}}
 */
export function replay(state) {
  state.playing = null
  state.nextIndex = 0
  if (state.total === 0) return { state, action: { type: 'play_fallback' } }
  return seekForward(state, 0)
}

// ── 内部 ──────────────────────────────────────────────

function play(state, index) {
  if (index >= state.total) return { state, action: { type: 'play_fallback' } }
  state.playing = index
  state.nextIndex = index
  return { state, action: { type: 'play', index } }
}

/** 从 from 开始找下一个应播段：跳过失败段；未就绪则兜底等待。 */
function seekForward(state, from) {
  let n = from
  while (n < state.total && state.failed.has(n)) n++
  if (n >= state.total) {
    state.playing = null
    state.nextIndex = state.total
    return { state, action: { type: 'play_fallback' } }  // 播完/无段 → 底模
  }
  if (state.ready.has(n)) return play(state, n)
  state.playing = null
  state.nextIndex = n
  return { state, action: { type: 'play_fallback' } }
}
