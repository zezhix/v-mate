// src/components/LiveLyricsMode.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LiveLyricsMode from './LiveLyricsMode.vue'

const script = [
  { time: 0, text: '第一句台词' },
  { time: 5, text: '第二句台词' },
  { time: 10, text: '第三句台词' },
]

function makeWrapper(props = {}) {
  return mount(LiveLyricsMode, {
    props: { script, currentTime: 0, ...props },
    attachTo: document.body,
  })
}

describe('LiveLyricsMode', () => {
  it('按 currentTime 高亮当前句', async () => {
    const wrapper = makeWrapper({ currentTime: 6 })
    const lines = wrapper.findAll('.lyric-line')
    expect(lines).toHaveLength(3)
    expect(lines[1].classes()).toContain('is-current')
    expect(lines[1].text()).toBe('第二句台词')
    expect(lines[0].classes()).not.toContain('is-current')
    wrapper.unmount()
  })

  it('currentTime 推进时高亮跟随移动', async () => {
    const wrapper = makeWrapper({ currentTime: 1 })
    expect(wrapper.findAll('.lyric-line')[0].classes()).toContain('is-current')
    await wrapper.setProps({ currentTime: 11 })
    expect(wrapper.findAll('.lyric-line')[2].classes()).toContain('is-current')
    wrapper.unmount()
  })

  it('视频循环重播回到首句', async () => {
    const wrapper = makeWrapper({ currentTime: 25 })
    expect(wrapper.findAll('.lyric-line')[2].classes()).toContain('is-current')
    await wrapper.setProps({ currentTime: 0 })
    expect(wrapper.findAll('.lyric-line')[0].classes()).toContain('is-current')
    wrapper.unmount()
  })

  it('script 为空时渲染空态文案', () => {
    const wrapper = makeWrapper({ script: [] })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.findAll('.lyric-line')).toHaveLength(0)
    wrapper.unmount()
  })
})
