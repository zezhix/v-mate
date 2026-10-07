// src/composables/useBroadcastJob.js — 串联 api/broadcast/timeline 的会话状态
import { ref, computed } from 'vue'
import { createPlayerState, reduceEvent, onEnded, replay as replayState } from '../utils/broadcast'
import { buildScript, lyricTime } from '../utils/timeline'
import * as api from '../api'

/** 重播后兜底视频先行、口播段延迟接入的时长（毫秒）。 */
const REPLAY_DELAY = 3000

export function useBroadcastJob({
  fallbackSrc,
  createJob = api.createJob,
  openEvents = api.openEvents,
  getCurrentJob = api.getCurrentJob,
} = {}) {
  const active = ref(false)
  const running = ref(false)               // 任务生成中："生成中"徽章只在运行态显示
  const chunks = ref([])                 // [{index,text,state,duration,url}]
  const videoSrc = ref(fallbackSrc)
  const currentSegment = ref(null)       // 正在播放的段号；null = 兜底
  const currentTime = ref(0)
  const restartLyric = ref(false)      // 重播后、口播段接入前：歌词定位到第一句
  const error = ref(null)
  const player = createPlayerState(0)
  let closeEvents = null
  let esErrors = 0                      // 连续 SSE 失败次数（收到事件即清零）
  let session = 0                       // 会话代号：start/stop 递增，作废在途异步
  let jobId = null                      // 当前会话任务号（对账切换时用）
  let replayTimer = null                // 重播延迟的到点计时器
  let replayDeadline = 0                // 口播段最早可接入的时间戳；0 = 无挂起延迟
  let replayPaused = false              // 暂停中：挂起接入，到期也不切
  let holdPlays = false                 // 页面刷新挂起：段接入等用户起播手势
  let pendingPlay = null                // 被延迟扣下的 play action

  const script = computed(() => buildScript(chunks.value))
  const lyricTimeValue = computed(() =>
    (restartLyric.value
      ? 0                                   // 重播定位到第一句：接入前保持 0
      : lyricTime(chunks.value, currentSegment.value, currentTime.value)))
  // 进度直接由 chunks 状态推导（深层数组 ref），并发 progress 帧无需 max 对账
  const progress = computed(() => ({
    ready: chunks.value.filter((c) => c.state === 'ready').length,
    total: chunks.value.length,
  }))
  const showProgress = computed(
    () => active.value && running.value
      && progress.value.ready < progress.value.total)

  function applyAction(action) {
    if (!action) return
    if (action.type === 'play') {
      // 重播延迟 / 刷新待起播：兜底先行，口播段到点或起播后才接入
      if (replayDeadline || pendingPlay || holdPlays) return gatePlay(action)
      applyPlay(action)
    } else if (action.type === 'preload') {
      preload(chunks.value[action.index]?.url)
    } else if (action.type === 'play_fallback') {
      videoSrc.value = fallbackSrc
      currentSegment.value = null
    }
  }

  function applyPlay(action) {
    const chunk = chunks.value[action.index]
    if (chunk?.url) {
      restartLyric.value = false        // 口播段接入 → 交回正常时间轴
      videoSrc.value = chunk.url
      currentSegment.value = action.index
    }
  }

  /**
   * 段接入闸门：重播延迟与页面刷新待起播共用。
   * 暂停中、或截止尚未定（等起播手势）→ 只挂起不排表；到点且在播 → 立即接入。
   */
  function gatePlay(action) {
    pendingPlay = action
    if (replayPaused || !replayDeadline) { clearReplayTimer(); return }
    armReplayTimer()
  }

  function flushPendingPlay() {
    const action = pendingPlay
    clearReplayDelay()
    if (action) applyPlay(action)
  }

  /** 按剩余时长排到点计时器：截止锚定重播点击或起播手势那一瞬。 */
  function armReplayTimer() {
    clearReplayTimer()
    const remaining = replayDeadline - Date.now()
    if (remaining <= 0) { flushPendingPlay(); return }
    replayTimer = setTimeout(flushPendingPlay, remaining)
  }

  function clearReplayTimer() {
    clearTimeout(replayTimer)
    replayTimer = null
  }

  function clearReplayDelay() {
    clearReplayTimer()
    replayDeadline = 0
    replayPaused = false
    holdPlays = false                   // 新会话/接入后不再等起播手势
    pendingPlay = null
  }

  /** 关闭事件流（幂等）：终态后后端已关流，前端不再让 EventSource 无限重连。 */
  function closeStream() {
    if (!closeEvents) return
    const fn = closeEvents
    closeEvents = null
    fn()
  }

  function handle(event) {
    if (!active.value) return             // stop()/终态关闭后到达的迟到事件不再改状态
    esErrors = 0                          // 收到任何事件都证明连接恢复
    if (event.type === 'snapshot') {
      hydrate(event.job)
      return
    }
    if (event.type === 'chunk_ready') {
      chunks.value[event.index] = {
        ...chunks.value[event.index],
        state: 'ready', duration: event.duration,
        url: event.url, text: event.text,
      }
    } else if (event.type === 'job_error' && event.index != null) {
      chunks.value[event.index] = { ...chunks.value[event.index], state: 'failed' }
      error.value = event.message
    }
    if (event.type === 'job_done') running.value = false   // 终态：徽章隐藏
    applyAction(reduceEvent(player, event).action)
    if (event.type === 'job_done') closeStream()   // 应用完毕后再关，防重发 job_done 打断播放
  }

  /** 断线重连/首连的对账基准：按任务全量状态重建就绪集。 */
  function hydrate(job) {
    chunks.value = job.chunks.map((c) => ({ ...c }))
    running.value = job.state === 'running'   // 徽章跟随快照的真实状态
    if (player.playing !== null) {
      // 静默重连：在播段不打断——只同步书签（ready 终态保证快照不与在播段矛盾）
      for (const c of job.chunks) {
        if (c.state === 'ready') player.ready.add(c.index)
        else if (c.state === 'failed') player.failed.add(c.index)
      }
      if (job.state === 'done') {
        applyAction(reduceEvent(player, { type: 'job_done' }).action)  // playing 时为 null
      }
      if (job.state === 'done' || job.state === 'failed') closeStream()
      return
    }
    const fresh = createPlayerState(job.chunks.length)
    Object.assign(player, fresh)
    for (const c of job.chunks) {
      if (c.state === 'ready') {
        applyAction(reduceEvent(player, { type: 'chunk_ready', index: c.index }).action)
      } else if (c.state === 'failed') {
        applyAction(reduceEvent(player, { type: 'job_error', index: c.index }).action)
      }
    }
    if (job.state === 'done') {
      applyAction(reduceEvent(player, { type: 'job_done' }).action)
    }
    if (job.state === 'done' || job.state === 'failed') closeStream()
  }

  async function start(text) {
    session += 1                      // 作废在途 restore/对账
    stop()                            // stop 内再递增一次（幂等：在途异步一律作废）
    const { job_id: id, chunks: preview } = await createJob(text)
    Object.assign(player, createPlayerState(preview.length))
    chunks.value = preview.map((c) => ({
      ...c, state: 'pending', duration: null, url: null,
    }))
    error.value = null
    esErrors = 0
    active.value = true
    running.value = true
    jobId = id
    videoSrc.value = fallbackSrc
    currentSegment.value = null
    closeEvents = openEvents(id, { onEvent: handle, onError: handleSseError })
    return id
  }

  /**
   * 页面加载恢复最近任务（GET /api/jobs/current）：
   * 进度徽章/滚动歌词/已生成段一次重建（同一快照同源，天然一致）；
   * 生成中的任务续订 SSE 继续走进度；终态任务快照即全量不连流。
   * 后端不可用或无历史任务 → 维持 mock 首屏；用户已确认新任务 → 放弃。
   */
  async function restore() {
    if (active.value) return
    const seq = session
    let job = null
    try {
      job = await getCurrentJob()
    } catch {
      return                          // 后端不可用 → 维持现状
    }
    if (!job || session !== seq || active.value) return   // 迟到响应被新会话作废
    jobId = job.id
    holdPlays = true                   // 页面刷新：视频先展示兜底
    restartLyric.value = true          // 歌词定位到第一句，段接入后交回正常时间轴
    hydrate(job)
    active.value = true
    esErrors = 0
    if (job.state === 'running') {
      closeEvents = openEvents(job.id, { onEvent: handle, onError: handleSseError })
    }
  }

  /** EventSource 自动重连；连续失败 3 次才提示，避免偶发断线打扰。 */
  function countSseFailure() {
    esErrors += 1
    if (esErrors >= 3) {
      error.value = '与后端连接中断，可重新确认口播'
    }
  }

  /**
   * SSE 错误分两类：
   * - readyState=CONNECTING（0）：浏览器自动重连 → 累计 3 次才提示；
   * - readyState=CLOSED（2）：服务端拒绝（任务已 404），重连已死 →
   *   立即与 /current 对账：有别的任务就静默切换续订，无则提示重新确认。
   */
  async function handleSseError(es) {
    if (!active.value) return             // 已停止的会话不累计断线次数、不发起对账
    if (!(es && es.readyState === 2)) {   // EventSource.CLOSED
      countSseFailure()
      return
    }
    const seq = session
    let job
    try {
      job = await getCurrentJob()
    } catch {
      job = undefined                     // 对账本身网络失败 → 按偶发断线处理
    }
    if (session !== seq || !active.value) return
    if (job === undefined) { countSseFailure(); return }
    if (job && job.id !== jobId) { adopt(job); return }
    // 确无任务：留着已渲染内容，仅隐藏徽章并明确提示
    closeStream()
    running.value = false
    error.value = '口播任务已失效，请重新确认口播'
  }

  /** 任务已被别端/重启替换：静默切到 /current 的任务并续订事件流。 */
  function adopt(job) {
    closeStream()
    jobId = job.id
    error.value = null
    esErrors = 0
    hydrate(job)
    active.value = true
    if (job.state === 'running') {
      closeEvents = openEvents(job.id, { onEvent: handle, onError: handleSseError })
    }
  }

  function stop() {
    session += 1
    closeStream()
    clearReplayDelay()                  // 新会话/停止不继承上一次重播的延迟
    active.value = false
    running.value = false
  }

  /**
   * 重播：先落兜底（App 端 replayTick 让兜底从头带声播），
   * 口播段存在则延迟 REPLAY_DELAY 毫秒才接入。
   */
  function replay() {
    clearReplayDelay()                  // 再次重播 → 重新计时
    replayDeadline = Date.now() + REPLAY_DELAY
    restartLyric.value = true            // 有台词就先定位到第一句
    currentTime.value = 0                // 视频回片头，歌词时间轴同步归零
    videoSrc.value = fallbackSrc        // 兜底先行，不等段
    currentSegment.value = null
    applyAction(replayState(player).action)
  }

  /** 暂停：挂起倒计时，到期也不自动切段（保留待接入段与截止时刻）。 */
  function pauseReplayDelay() {
    if (!replayDeadline) return
    replayPaused = true
    clearReplayTimer()
  }

  /** 恢复播放（起播手势）：定截止并按剩余时长续排；已过点则立即接入。 */
  function resumeReplayDelay() {
    replayPaused = false
    if (holdPlays && !replayDeadline) replayDeadline = Date.now() + REPLAY_DELAY
    if (pendingPlay) armReplayTimer()
  }

  return {
    videoSrc, script, lyricTime: lyricTimeValue, progress, showProgress,
    active, error, currentSegment,
    start, stop, restore,
    onEndedVideo: () => applyAction(onEnded(player).action),
    replay,
    pauseReplayDelay,
    resumeReplayDelay,
    onTimeUpdate: (t) => { currentTime.value = t },
    onSegmentError: () => {
      if (currentSegment.value == null) return
      const failed = currentSegment.value
      chunks.value[failed] = { ...chunks.value[failed], state: 'failed' }
      player.failed.add(failed)
      applyAction(onEnded(player).action)
    },
  }
}

/** 段视频预加载：下一段提前就绪时先在隐藏 video 里拉流，减少切换停顿。 */
const preloaded = new Map()
function preload(url) {
  if (!url || preloaded.has(url)) return
  const el = document.createElement('video')
  el.preload = 'auto'
  el.src = url
  preloaded.set(url, el)
}
