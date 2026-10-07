// src/components/DigitalHumanVideo.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DigitalHumanVideo from './DigitalHumanVideo.vue'

function makeVideoWrapper(props = {}) {
  return mount(DigitalHumanVideo, {
    props: { src: '/vedio.mp4', ...props },
    attachTo: document.body,
  })
}

describe('DigitalHumanVideo', () => {
  it('默认静音渲染，且 loop/autoplay/playsinline、无原生控制条', () => {
    const wrapper = makeVideoWrapper()
    const video = wrapper.find('video')
    expect(video.exists()).toBe(true)
    // muted 规则裁定：Vue 将 muted 作为 DOM property 应用而非 attribute，
    // 故断言改为 property 检查（要求不变：默认必须静音以允许自动播放）
    expect(video.element.muted).toBe(true)
    expect(video.attributes('loop')).toBeDefined()
    expect(video.attributes('autoplay')).toBeDefined()
    expect(video.attributes('playsinline')).toBeDefined()
    expect(video.attributes('controls')).toBeUndefined()
    wrapper.unmount()
  })

  it('muted prop 变化时同步到 video 元素（解除静音播放声音）', async () => {
    const wrapper = makeVideoWrapper({ muted: true })
    const video = wrapper.find('video')
    expect(video.element.muted).toBe(true)

    await wrapper.setProps({ muted: false })
    expect(video.element.muted).toBe(false)

    await wrapper.setProps({ muted: true })
    expect(video.element.muted).toBe(true)
    wrapper.unmount()
  })

  it('timeupdate 上抛当前秒数', async () => {
    const wrapper = makeVideoWrapper()
    const video = wrapper.find('video')
    Object.defineProperty(video.element, 'currentTime', { value: 12.5, configurable: true })
    await video.trigger('timeupdate')
    expect(wrapper.emitted('update:currentTime')).toBeTruthy()
    expect(wrapper.emitted('update:currentTime')[0]).toEqual([12.5])
    wrapper.unmount()
  })

  it('渲染左缘颜色过渡层 edge-fade', () => {
    const wrapper = makeVideoWrapper()
    expect(wrapper.find('.edge-fade').exists()).toBe(true)
    wrapper.unmount()
  })

  it('播放失败时显示占位并 emit error', async () => {
    const wrapper = makeVideoWrapper()
    await wrapper.find('video').trigger('error')
    expect(wrapper.emitted('error')).toBeTruthy()
    expect(wrapper.find('.video-error').exists()).toBe(true)
    expect(wrapper.find('video').exists()).toBe(false)
    wrapper.unmount()
  })

  it('不再渲染进度条（按用户要求完全隐藏）', () => {
    const wrapper = makeVideoWrapper()
    expect(wrapper.find('.progress-bar').exists()).toBe(false)
    expect(wrapper.find('.progress-fill').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('DigitalHumanVideo loop/ended', () => {
  it('loop=false 时透传关闭，并上抛 ended 事件', async () => {
    const wrapper = makeVideoWrapper({ loop: false })
    expect(wrapper.find('video').attributes('loop')).toBeUndefined()
    await wrapper.find('video').trigger('ended')
    expect(wrapper.emitted('ended')).toHaveLength(1)
    wrapper.unmount()
  })

  it('src 切换后重置加载失败状态（兜底 ↔ 段切换不留错误页）', async () => {
    const wrapper = makeVideoWrapper()
    await wrapper.find('video').trigger('error')
    expect(wrapper.find('.video-error').exists()).toBe(true)
    await wrapper.setProps({ src: '/seg_000.mp4' })
    expect(wrapper.find('video').exists()).toBe(true)
    expect(wrapper.find('.video-error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('replayTick 变化 → currentTime 归零并调用 play（src 未变也从头播）', async () => {
    const wrapper = makeVideoWrapper()
    const el = wrapper.find('video').element
    let t = 5
    Object.defineProperty(el, 'currentTime', {
      get: () => t, set: (v) => { t = v }, configurable: true,
    })
    const calls = { play: 0 }
    el.play = () => { calls.play += 1 }

    await wrapper.setProps({ replayTick: 1 })
    expect(el.currentTime).toBe(0)
    expect(calls.play).toBe(1)
    wrapper.unmount()
  })
})

describe('DigitalHumanVideo 播放/暂停', () => {
  it('paused 切换时调用 video 元素的 pause()/play()（play 返回 undefined 也不报错）', async () => {
    const wrapper = makeVideoWrapper({ paused: false })
    const el = wrapper.find('video').element
    const calls = { pause: 0, play: 0 }
    el.pause = () => { calls.pause += 1 }
    el.play = () => { calls.play += 1 }   // 模拟 jsdom：play 无返回值

    await wrapper.setProps({ paused: true })
    expect(calls.pause).toBe(1)
    await wrapper.setProps({ paused: false })
    expect(calls.play).toBe(1)
    wrapper.unmount()
  })

  it('paused=true 时无 autoplay 属性（暂停态换段不自动续播）', async () => {
    const wrapper = makeVideoWrapper({ paused: false })
    const el = wrapper.find('video').element
    el.pause = () => {}                       // jsdom 未实现媒体方法，按文件约定覆写
    el.play = () => {}
    expect(wrapper.find('video').attributes('autoplay')).toBeDefined()

    await wrapper.setProps({ paused: true })
    expect(wrapper.find('video').attributes('autoplay')).toBeUndefined()

    await wrapper.setProps({ src: '/seg_001.mp4' })   // 暂停态换段
    expect(wrapper.find('video').attributes('autoplay')).toBeUndefined()
    wrapper.unmount()
  })

  it('暂停态下 src 切换再兜底调用一次 pause（防换段竞态自动播）', async () => {
    const wrapper = makeVideoWrapper({ paused: true })
    const el = wrapper.find('video').element
    let pauses = 0
    el.pause = () => { pauses += 1 }

    await wrapper.setProps({ src: '/seg_002.mp4' })
    expect(pauses).toBe(1)
    wrapper.unmount()
  })

  it('播放失败态（无 video 元素）下切换 paused 不报错', async () => {
    const wrapper = makeVideoWrapper()
    await wrapper.find('video').trigger('error')
    expect(wrapper.find('video').exists()).toBe(false)
    await wrapper.setProps({ paused: true })
    await wrapper.setProps({ paused: false })
    expect(wrapper.emitted('error')).toBeTruthy()
    wrapper.unmount()
  })
})
