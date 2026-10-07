// src/utils/broadcast.test.js
import { describe, it, expect } from 'vitest'
import { createPlayerState, reduceEvent, onEnded, replay } from './broadcast'

const ready = (index) => ({ type: 'chunk_ready', index })
const errored = (index) => ({ type: 'job_error', index })
const done = { type: 'job_done', total: 3 }

function apply(state, ...events) {
  let action = null
  for (const ev of events) ({ state, action } = reduceEvent(state, ev))
  return { state, action }
}

describe('播放决策状态机', () => {
  it('首段就绪且正在兜底 → 播放首段', () => {
    const s = createPlayerState(3)
    const { state, action } = apply(s, ready(0))
    expect(action).toEqual({ type: 'play', index: 0 })
    expect(state.playing).toBe(0)
    expect(state.nextIndex).toBe(0)
  })

  it('下一段提前就绪 → 仅预加载，不打断当前播放', () => {
    const s = createPlayerState(3)
    let r = apply(s, ready(0))
    r = apply(r.state, ready(1))
    expect(r.action).toEqual({ type: 'preload', index: 1 })
    expect(r.state.playing).toBe(0)
  })

  it('当前段 ended 且下一段已就绪 → 顺序接播', () => {
    const s = createPlayerState(3)
    let r = apply(s, ready(0), ready(1))
    r = { state: r.state, action: onEnded(r.state).action }
    expect(r.action).toEqual({ type: 'play', index: 1 })
    expect(r.state.playing).toBe(1)
  })

  it('当前段 ended 但下一段未就绪 → 兜底等待，就绪事件到达后接上', () => {
    const s = createPlayerState(3)
    let r = apply(s, ready(0))
    r = { state: r.state, action: onEnded(r.state) }
    expect(r.action.action).toEqual({ type: 'play_fallback' })
    expect(r.state.playing).toBeNull()
    expect(r.state.nextIndex).toBe(1)
    r = apply(r.state, ready(1))                  // 等待期间就绪
    expect(r.action).toEqual({ type: 'play', index: 1 })
    expect(r.state.playing).toBe(1)
  })

  it('等待兜底时 job_error 恰好指向等待段 → 跳段不死等', () => {
    const s = createPlayerState(3)
    let r = apply(s, ready(0))
    r = { state: r.state, action: onEnded(r.state) }   // 兜底等第 1 段
    r = apply(r.state, errored(1))
    expect(r.state.nextIndex).toBe(2)
    expect(r.action).toEqual({ type: 'play_fallback' })
    r = apply(r.state, ready(2))                  // 第 2 段到达即播
    expect(r.action).toEqual({ type: 'play', index: 2 })
  })

  it('最后一段 ended 且任务完成 → 切到底模，不回卷口播', () => {
    let { state } = apply(createPlayerState(3), ready(0), ready(1), ready(2), done)
    let res = onEnded(state)                          // 0 → 1
    expect(res.action).toEqual({ type: 'play', index: 1 })
    res = onEnded(res.state)                          // 1 → 2
    expect(res.action).toEqual({ type: 'play', index: 2 })
    res = onEnded(res.state)                          // 2 → 底模（不回卷）
    expect(res.action).toEqual({ type: 'play_fallback' })
    expect(res.state.playing).toBeNull()
    expect(res.state.nextIndex).toBe(3)
  })

  it('最后一段 ended 但任务未完成 → 兜底；job_done 到达后仍停底模', () => {
    let { state } = apply(createPlayerState(3), ready(0), ready(1), ready(2))
    let res = onEnded(state)                          // 0 → 1
    res = onEnded(res.state)                          // 1 → 2
    res = onEnded(res.state)                          // 2 → 等 job_done，兜底
    expect(res.action).toEqual({ type: 'play_fallback' })
    expect(res.state.nextIndex).toBe(3)
    const fin = reduceEvent(res.state, done)
    expect(fin.action).toEqual({ type: 'play_fallback' })   // 不回卷，停在底模
    expect(fin.state.playing).toBeNull()
  })
})

describe('replay 重播', () => {
  it('从第 0 段重新开始（当前在段 2）', () => {
    let { state } = apply(createPlayerState(3), ready(0), ready(1), ready(2), done)
    let res = onEnded(state)                          // 0 → 1
    res = onEnded(res.state)                          // 1 → 2
    res = replay(res.state)                           // 在段 2 → 重播回段 0
    expect(res.action).toEqual({ type: 'play', index: 0 })
    expect(res.state.playing).toBe(0)
    expect(res.state.nextIndex).toBe(0)
  })

  it('跳过失败段，从第一个可播段开始', () => {
    const { state } = apply(createPlayerState(3), errored(0), ready(1), ready(2), done)
    const res = replay(state)
    expect(res.action).toEqual({ type: 'play', index: 1 })
    expect(res.state.playing).toBe(1)
  })

  it('第 0 段未就绪 → 兜底等待，就绪后接上', () => {
    let { state } = apply(createPlayerState(3), ready(1))   // 0 未就绪
    let res = replay(state)
    expect(res.action).toEqual({ type: 'play_fallback' })
    expect(res.state.nextIndex).toBe(0)
    res = apply(res.state, ready(0))                        // 等待期间就绪
    expect(res.action).toEqual({ type: 'play', index: 0 })
  })

  it('无任务（total=0）→ 底模', () => {
    const res = replay(createPlayerState(0))
    expect(res.action).toEqual({ type: 'play_fallback' })
  })
})
