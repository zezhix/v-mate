// src/composables/useBroadcastJob.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBroadcastJob } from './useBroadcastJob'

const chunk0 = { type: 'chunk_ready', index: 0, url: '/media/j1/seg_000.mp4',
                 duration: 2, text: '第一句。' }
const chunk1 = { type: 'chunk_ready', index: 1, url: '/media/j1/seg_001.mp4',
                 duration: 3, text: '第二句。' }

function makeHarness({ getCurrentJob } = {}) {
  const handlers = {}
  const mocks = {
    createJob: vi.fn(async () => ({
      job_id: 'j1',
      chunks: [{ index: 0, text: '第一句。' }, { index: 1, text: '第二句。' }],
    })),
    openEvents: vi.fn((id, h) => {
      handlers.onEvent = h.onEvent
      handlers.onError = h.onError
      return () => { handlers.closed = true }
    }),
    getCurrentJob: getCurrentJob || vi.fn(async () => null),
  }
  const harness = useBroadcastJob({
    fallbackSrc: 'fallback.mp4',
    ...mocks,
  })
  return { harness, handlers, mocks }
}

describe('useBroadcastJob', () => {
  it('start 后默认兜底；首段就绪切到段视频', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    expect(harness.active.value).toBe(true)
    handlers.onEvent(chunk0)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
    expect(harness.currentSegment.value).toBe(0)
  })

  it('段播完等下一段 → 兜底；job_error 跳段等待；job_done 仍停底模不回卷', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    harness.onEndedVideo()
    expect(harness.videoSrc.value).toBe('fallback.mp4')      // 段 1 未就绪
    handlers.onEvent({ type: 'job_error', index: 1, message: '渲染失败' })
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    expect(harness.error.value).toBe('渲染失败')
    handlers.onEvent({ type: 'job_done' })
    expect(harness.videoSrc.value).toBe('fallback.mp4')      // 不回卷，停在底模
    expect(harness.currentSegment.value).toBeNull()
  })

  it('replay()：无任务时落底模；有任务时先落兜底，3 秒后回到段 0', async () => {
    vi.useFakeTimers()
    try {
      const { harness, handlers } = makeHarness()
      harness.replay()
      expect(harness.videoSrc.value).toBe('fallback.mp4')      // 无任务 → 底模
      await harness.start('文案')
      handlers.onEvent(chunk0)
      handlers.onEvent(chunk1)
      harness.onEndedVideo()                                   // 段 0 → 段 1
      expect(harness.currentSegment.value).toBe(1)
      harness.replay()
      expect(harness.videoSrc.value).toBe('fallback.mp4')      // 重播先播兜底
      expect(harness.currentSegment.value).toBeNull()
      vi.advanceTimersByTime(3000)
      expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
      expect(harness.currentSegment.value).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('预加载事件不打断当前播放', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    handlers.onEvent(chunk1)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
    expect(harness.currentSegment.value).toBe(0)
  })

  it('歌词时间：播放中累加、兜底时冻结在段边界', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)                                    // 段 0 时长 2s
    harness.onTimeUpdate(1.2)
    expect(harness.lyricTime.value).toBeCloseTo(1.2, 5)
    harness.onEndedVideo()                                      // 兜底等待段 1
    harness.onTimeUpdate(99)                                    // 兜底视频在播但歌词冻结
    expect(harness.lyricTime.value).toBeCloseTo(2, 5)
    expect(harness.script.value).toHaveLength(1)                 // 段 1 未就绪不参与
    handlers.onEvent(chunk1)
    expect(harness.script.value).toHaveLength(2)
  })

  it('进度与停止：ready/total 随段更新，stop 关闭事件流', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    expect(harness.progress.value).toEqual({ ready: 1, total: 2 })
    expect(harness.showProgress.value).toBe(true)
    handlers.onEvent({ ...chunk1 })
    handlers.onEvent({ type: 'job_done' })
    expect(harness.showProgress.value).toBe(false)              // 全部就绪后隐藏
    harness.stop()
    expect(handlers.closed).toBe(true)
    expect(harness.active.value).toBe(false)
  })

  it('snapshot 对账：重连后按任务状态恢复就绪集与播放', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent({
      type: 'snapshot',
      job: { id: 'j1', state: 'done', chunks: [
        { index: 0, text: '第一句。', state: 'ready', duration: 2,
          url: '/media/j1/seg_000.mp4' },
        { index: 1, text: '第二句。', state: 'ready', duration: 3,
          url: '/media/j1/seg_001.mp4' },
      ] },
    })
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')  // 等待中恢复 → 直接播
    expect(harness.progress.value).toEqual({ ready: 2, total: 2 })
  })

  it('段视频加载失败（404）→ 视为 failed 并跳段', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    handlers.onEvent(chunk1)                                    // 段 1 已预载记录
    harness.onSegmentError()                                    // 段 0 播放中损坏
    expect(harness.currentSegment.value).toBe(1)                // 直接跳到段 1
    expect(harness.videoSrc.value).toBe('/media/j1/seg_001.mp4')
  })

  it('事件流连续失败 3 次 → 提示连接中断；收到事件即清零', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onError()
    handlers.onError()
    expect(harness.error.value).toBeNull()                      // 偶发断线不打扰
    handlers.onError()
    expect(harness.error.value).toBe('与后端连接中断，可重新确认口播')
    handlers.onEvent(chunk0)                                    // 重连成功
    await harness.start('新文案')                                // start 重置提示
    expect(harness.error.value).toBeNull()
  })

  it('job_done 后自动关闭事件流，stop 再关一次也安全', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    handlers.onEvent(chunk1)
    handlers.onEvent({ type: 'job_done' })
    expect(handlers.closed).toBe(true)                          // 后端已关流，前端不再重连
    harness.stop()
    expect(handlers.closed).toBe(true)                          // 幂等：重复关闭不抛错
  })

  it('终态 snapshot 对账后关闭事件流；运行中的 snapshot 保持连接', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent({
      type: 'snapshot',
      job: { id: 'j1', state: 'running', chunks: [
        { index: 0, text: '第一句。', state: 'pending', duration: null, url: null },
        { index: 1, text: '第二句。', state: 'pending', duration: null, url: null },
      ] },
    })
    expect(handlers.closed).toBeUndefined()                     // 运行中靠心跳保活
    handlers.onEvent({
      type: 'snapshot',
      job: { id: 'j1', state: 'failed', chunks: [
        { index: 0, text: '第一句。', state: 'failed', duration: null, url: null },
        { index: 1, text: '第二句。', state: 'pending', duration: null, url: null },
      ] },
    })
    expect(handlers.closed).toBe(true)                          // 终态即关，防无限重连
  })

  it('在播段遇 running 快照：对账但不打断当前播放', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent({ ...chunk0, duration: 5 })                // 段 0 就绪（5s，稍后由快照对账为 2s）
    handlers.onEvent(chunk1)                                    // 段 1 就绪 → 预载
    harness.onEndedVideo()                                      // 段 0 播完 → 播段 1
    expect(harness.currentSegment.value).toBe(1)
    handlers.onEvent({
      type: 'snapshot',
      job: { id: 'j1', state: 'running', chunks: [
        { index: 0, text: '第一句。', state: 'ready', duration: 2,
          url: '/media/j1/seg_000.mp4' },
        { index: 1, text: '第二句。', state: 'ready', duration: 3,
          url: '/media/j1/seg_001.mp4' },
      ] },
    })
    expect(harness.videoSrc.value).toBe('/media/j1/seg_001.mp4')  // 断线静默重连：不回跳段 0
    expect(harness.currentSegment.value).toBe(1)
    expect(handlers.closed).toBeUndefined()                     // running 快照保持连接
    harness.onTimeUpdate(1)
    expect(harness.lyricTime.value).toBeCloseTo(3, 5)           // 段 0 时长对账为 2s（2+1）→ hydrate 确已运行
    expect(harness.script.value).toHaveLength(2)                 // 就绪集已按快照重建
  })
})

// ── 重播延迟：先播兜底，口播段 3 秒后接入 ────────────────

describe('replay 延迟接入口播段', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('重播立即落兜底，3 秒后才切到首段', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')

    harness.replay()
    expect(harness.videoSrc.value).toBe('fallback.mp4')        // 先播兜底
    expect(harness.currentSegment.value).toBeNull()
    vi.advanceTimersByTime(2999)
    expect(harness.videoSrc.value).toBe('fallback.mp4')        // 未到 3 秒
    vi.advanceTimersByTime(1)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')  // 到点切段
    expect(harness.currentSegment.value).toBe(0)
  })

  it('重播时首段未就绪：3 秒内就绪也要等到 3 秒才切', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')                                 // 尚无就绪段
    harness.replay()
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    vi.advanceTimersByTime(1000)
    handlers.onEvent(chunk0)                                    // 3 秒内就绪 → 仍不切
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    vi.advanceTimersByTime(2000)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })

  it('3 秒后才就绪 → 就绪即切（3 秒封顶）', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    harness.replay()
    vi.advanceTimersByTime(4000)
    expect(harness.videoSrc.value).toBe('fallback.mp4')        // 仍未就绪，停在兜底
    handlers.onEvent(chunk0)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')  // 就绪立即接上
  })

  it('倒计时内再次重播 → 重新计满 3 秒', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    harness.replay()
    vi.advanceTimersByTime(2000)
    harness.replay()                                            // 重播重计时
    vi.advanceTimersByTime(2000)
    expect(harness.videoSrc.value).toBe('fallback.mp4')        // 旧计时已作废
    vi.advanceTimersByTime(1000)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })

  it('暂停挂起倒计时：暂停期间到期不切，恢复播放立即接入', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    harness.replay()
    vi.advanceTimersByTime(1000)
    harness.pauseReplayDelay()
    vi.advanceTimersByTime(10000)                               // 暂停期间跨过截止时刻
    expect(harness.videoSrc.value).toBe('fallback.mp4')         // 不自动切段
    harness.resumeReplayDelay()
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')  // 截止已过 → 立即接入
    expect(harness.currentSegment.value).toBe(0)
  })

  it('暂停期间未就绪的段在截止后就绪 → 恢复播放立即接入', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    harness.replay()
    vi.advanceTimersByTime(5000)
    harness.pauseReplayDelay()
    handlers.onEvent(chunk0)                                    // 暂停中就绪 → 不切
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    harness.resumeReplayDelay()
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })

  it('重播延迟未到期时 start 新任务 → 延迟作废，首段就绪立即切', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    harness.replay()                                            // 挂起 3 秒延迟
    await harness.start('新文案')
    handlers.onEvent(chunk0)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')  // 新任务不受旧延迟影响
    vi.advanceTimersByTime(3000)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })

  it('stop 后挂起的延迟作废，不再切段', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    harness.replay()
    harness.stop()
    vi.advanceTimersByTime(3000)
    expect(harness.videoSrc.value).toBe('fallback.mp4')
  })
})

// ── 重播歌词定位到第一句 ──────────────────────────────

describe('重播歌词定位到第一句', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('点重播即归零；段接入后按播放进度推进', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)                                    // 段 0 时长 2s
    handlers.onEvent(chunk1)
    harness.onTimeUpdate(1.2)
    expect(harness.lyricTime.value).toBeCloseTo(1.2, 5)         // 播放中：段基址 + currentTime

    harness.replay()
    expect(harness.lyricTime.value).toBe(0)                     // 点击即第一句（兜底 3 秒内）

    vi.advanceTimersByTime(3000)                                // 口播段接入
    expect(harness.lyricTime.value).toBe(0)                     // 仍在第一句（currentTime 已归零）
    harness.onTimeUpdate(0.5)
    expect(harness.lyricTime.value).toBeCloseTo(0.5, 5)         // 恢复正常推进
  })

  it('兜底等待中重播 → 歌词从段边界回到第一句', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)                                    // 段 0 就绪，段 1 未就绪
    harness.onEndedVideo()                                      // → 落兜底等段 1
    harness.onTimeUpdate(99)
    expect(harness.lyricTime.value).toBeCloseTo(2, 5)           // 现有语义：冻结在段边界

    harness.replay()
    expect(harness.lyricTime.value).toBe(0)                     // 重播 → 第一句
  })

  it('段未接入期间暂停：歌词停在第一句；接入后恢复正常', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    harness.onTimeUpdate(1.5)
    harness.replay()
    harness.pauseReplayDelay()
    vi.advanceTimersByTime(10000)                               // 暂停期间不接入
    expect(harness.lyricTime.value).toBe(0)
    harness.resumeReplayDelay()
    expect(harness.lyricTime.value).toBe(0)
    harness.onTimeUpdate(0.8)
    expect(harness.lyricTime.value).toBeCloseTo(0.8, 5)
  })
})

// ── 页面加载恢复（/api/jobs/current）与任务失效对账 ──────────

const doneJob = { id: 'j2', state: 'done', chunks: [
  { index: 0, text: '第一句。', state: 'ready', duration: 2,
    url: '/media/j2/seg_000.mp4' },
  { index: 1, text: '失败句。', state: 'failed', duration: null, url: null },
] }

const runningJob = { id: 'j2', state: 'running', chunks: [
  { index: 0, text: '第一句。', state: 'ready', duration: 2,
    url: '/media/j2/seg_000.mp4' },
  { index: 1, text: '第二句。', state: 'pending', duration: null, url: null },
] }

describe('restore 页面加载恢复', () => {
  it('无历史任务 → 保持兜底首屏，不开事件流', async () => {
    const { harness, mocks } = makeHarness()
    await harness.restore()
    expect(mocks.getCurrentJob).toHaveBeenCalledTimes(1)
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    expect(harness.active.value).toBe(false)
    expect(mocks.openEvents).not.toHaveBeenCalled()
  })

  it('已完成任务 → 先展示兜底、不开 SSE、不出生成中徽章、失败段不进歌词', async () => {
    const { harness, mocks } = makeHarness({
      getCurrentJob: vi.fn(async () => doneJob),
    })
    await harness.restore()
    expect(harness.active.value).toBe(true)
    expect(harness.videoSrc.value).toBe('fallback.mp4')       // 刷新先展示兜底
    expect(harness.currentSegment.value).toBeNull()
    expect(harness.progress.value).toEqual({ ready: 1, total: 2 })
    expect(harness.showProgress.value).toBe(false)          // 终态绝不出"生成中"
    expect(harness.script.value.map((s) => s.text)).toEqual(['第一句。'])
    expect(mocks.openEvents).not.toHaveBeenCalled()
  })

  it('生成中任务 → hydrate 后续订 SSE，进度继续推进', async () => {
    const { harness, handlers, mocks } = makeHarness({
      getCurrentJob: vi.fn(async () => runningJob),
    })
    await harness.restore()
    expect(harness.videoSrc.value).toBe('fallback.mp4')       // 刷新先展示兜底
    expect(mocks.openEvents).toHaveBeenCalledWith('j2', expect.anything())
    expect(harness.showProgress.value).toBe(true)           // 1/2 生成中
    handlers.onEvent({ type: 'chunk_ready', index: 1,
                       url: '/media/j2/seg_001.mp4', duration: 3,
                       text: '第二句。' })
    expect(harness.progress.value).toEqual({ ready: 2, total: 2 })
    expect(harness.showProgress.value).toBe(false)
  })

  it('与确认口播竞争：start 已发起则迟到的恢复被放弃', async () => {
    let resolveGet
    const { harness, mocks } = makeHarness({
      getCurrentJob: vi.fn(() => new Promise((r) => { resolveGet = r })),
    })
    const restoring = harness.restore()                    // 挂起中
    await harness.start('新文案')                           // 用户先点了确认
    resolveGet(doneJob)
    await restoring
    expect(harness.videoSrc.value).toBe('fallback.mp4')     // 新任务会话未被覆盖
    expect(mocks.openEvents).toHaveBeenCalledTimes(1)
    expect(mocks.openEvents.mock.calls[0][0]).toBe('j1')
  })

  it('确认口播失败不停止已恢复的会话语义（start 前 restore 已完成则 start 正常接管）', async () => {
    const { harness, mocks } = makeHarness({
      getCurrentJob: vi.fn(async () => doneJob),
    })
    await harness.restore()
    expect(harness.videoSrc.value).toBe('fallback.mp4')       // 刷新先展示兜底
    await harness.start('新文案')                           // start 一律接管
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    expect(mocks.openEvents).toHaveBeenCalledWith('j1', expect.anything())
  })
})

// ── 页面刷新：先展示兜底，起播后 3 秒接入 ────────────────

describe('页面刷新先展示兜底', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const restored = { id: 'j9', state: 'done', chunks: [
    { index: 0, text: '第一句。', state: 'ready', duration: 2,
      url: '/media/j9/seg_000.mp4' },
    { index: 1, text: '第二句。', state: 'ready', duration: 3,
      url: '/media/j9/seg_001.mp4' },
  ] }

  it('恢复后停在兜底、歌词定位第一句；点播放 3 秒后才接入口播段', async () => {
    const { harness } = makeHarness({ getCurrentJob: vi.fn(async () => restored) })
    await harness.restore()
    expect(harness.videoSrc.value).toBe('fallback.mp4')       // 先展示兜底
    expect(harness.currentSegment.value).toBeNull()
    expect(harness.lyricTime.value).toBe(0)                   // 歌词定位第一句

    harness.resumeReplayDelay()                               // 用户点播放
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    vi.advanceTimersByTime(2999)
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    vi.advanceTimersByTime(1)
    expect(harness.videoSrc.value).toBe('/media/j9/seg_000.mp4')
    expect(harness.currentSegment.value).toBe(0)
    expect(harness.lyricTime.value).toBe(0)                   // 接入后仍在第一句
    harness.onTimeUpdate(0.6)
    expect(harness.lyricTime.value).toBeCloseTo(0.6, 5)       // 恢复正常推进
  })

  it('未起播就不计时：停在兜底、歌词保持第一句', async () => {
    const { harness } = makeHarness({ getCurrentJob: vi.fn(async () => restored) })
    await harness.restore()
    vi.advanceTimersByTime(60000)
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    expect(harness.lyricTime.value).toBe(0)
  })

  it('起播后暂停跨截止不接入，恢复播放立即接入', async () => {
    const { harness } = makeHarness({ getCurrentJob: vi.fn(async () => restored) })
    await harness.restore()
    harness.resumeReplayDelay()
    vi.advanceTimersByTime(1000)
    harness.pauseReplayDelay()
    vi.advanceTimersByTime(10000)                             // 暂停期间跨过截止
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    harness.resumeReplayDelay()
    expect(harness.videoSrc.value).toBe('/media/j9/seg_000.mp4')
  })

  it('恢复时首段未就绪 → 起播后 3 秒内就绪仍等到 3 秒', async () => {
    const { harness, handlers } = makeHarness({
      getCurrentJob: vi.fn(async () => ({ id: 'j9', state: 'running', chunks: [
        { index: 0, text: '第一句。', state: 'pending', duration: null, url: null },
      ] })),
    })
    await harness.restore()
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    harness.resumeReplayDelay()                               // 用户已点播放
    vi.advanceTimersByTime(1000)
    handlers.onEvent(chunk0)                                  // 首段这时才就绪
    expect(harness.videoSrc.value).toBe('fallback.mp4')       // 3 秒未到
    vi.advanceTimersByTime(2000)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })

  it('未起播时首段就绪也挂起，起播后 3 秒接入', async () => {
    const { harness, handlers } = makeHarness({
      getCurrentJob: vi.fn(async () => ({ id: 'j9', state: 'running', chunks: [
        { index: 0, text: '第一句。', state: 'pending', duration: null, url: null },
      ] })),
    })
    await harness.restore()
    handlers.onEvent(chunk0)                                  // 未起播就绪 → 挂起
    vi.advanceTimersByTime(60000)
    expect(harness.videoSrc.value).toBe('fallback.mp4')
    harness.resumeReplayDelay()
    vi.advanceTimersByTime(3000)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })

  it('恢复挂起中点重播 → 按重播的 3 秒走，不等起播手势', async () => {
    const { harness } = makeHarness({ getCurrentJob: vi.fn(async () => restored) })
    await harness.restore()
    harness.replay()
    vi.advanceTimersByTime(3000)
    expect(harness.videoSrc.value).toBe('/media/j9/seg_000.mp4')
  })

  it('恢复挂起中确认新口播 → 挂起作废，首段就绪立即播', async () => {
    const { harness, handlers } = makeHarness({
      getCurrentJob: vi.fn(async () => restored),
    })
    await harness.restore()
    await harness.start('新文案')
    handlers.onEvent(chunk0)
    expect(harness.videoSrc.value).toBe('/media/j1/seg_000.mp4')
  })
})

describe('SSE 彻底失效（CLOSED）对账恢复', () => {
  it('current 有别的任务 → 静默切换，续订新任务事件流', async () => {
    const nextJob = { id: 'j3', state: 'running', chunks: [
      { index: 0, text: '新任务句', state: 'pending', duration: null, url: null },
    ] }
    const { harness, handlers, mocks } = makeHarness({
      getCurrentJob: vi.fn(async () => nextJob),
    })
    await harness.start('文案')
    await handlers.onError({ readyState: 2 })               // 404 → 不再自动重连
    expect(mocks.openEvents).toHaveBeenCalledTimes(2)
    expect(mocks.openEvents.mock.calls[1][0]).toBe('j3')
    expect(harness.error.value).toBeNull()                  // 静默切换不打扰
    expect(harness.active.value).toBe(true)
  })

  it('current 无任务 → 提示重新确认口播', async () => {
    const { harness, handlers } = makeHarness({
      getCurrentJob: vi.fn(async () => null),
    })
    await harness.start('文案')
    await handlers.onError({ readyState: 2 })
    expect(harness.error.value).toBe('口播任务已失效，请重新确认口播')
  })

  it('对账本身网络失败 → 按偶发断线累计，不误报任务失效', async () => {
    const { harness, handlers } = makeHarness({
      getCurrentJob: vi.fn(async () => { throw new Error('net down') }),
    })
    await harness.start('文案')
    await handlers.onError({ readyState: 2 })
    expect(harness.error.value).toBeNull()                  // 1 次不到 3 次阈值
  })

  it('已停止的会话不发起对账', async () => {
    const { harness, handlers, mocks } = makeHarness()
    await harness.start('文案')
    harness.stop()
    await handlers.onError({ readyState: 2 })
    expect(mocks.getCurrentJob).not.toHaveBeenCalled()
  })
})

describe('生成中徽章只在运行态显示', () => {
  it('含失败段的 job_done 隐藏徽章', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    handlers.onEvent({ type: 'job_error', index: 1, message: '渲染失败' })
    expect(harness.showProgress.value).toBe(true)           // 跑完前 1/2
    handlers.onEvent({ type: 'job_done' })
    expect(harness.showProgress.value).toBe(false)          // 终态即隐藏
  })

  it('stop 后徽章消失', async () => {
    const { harness, handlers } = makeHarness()
    await harness.start('文案')
    handlers.onEvent(chunk0)
    expect(harness.showProgress.value).toBe(true)
    harness.stop()
    expect(harness.showProgress.value).toBe(false)
  })
})
