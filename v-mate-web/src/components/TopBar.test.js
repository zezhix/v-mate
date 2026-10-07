// src/components/TopBar.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TopBar from './TopBar.vue'

describe('TopBar', () => {
  it('渲染带 data-settings-trigger 的齿轮按钮，无标题文字', () => {
    const wrapper = mount(TopBar, { props: { open: false } })
    const btn = wrapper.find('button[data-settings-trigger]')
    expect(btn.exists()).toBe(true)
    expect(wrapper.text().trim()).toBe('')
  })

  it('点击齿轮 emit toggle', async () => {
    const wrapper = mount(TopBar, { props: { open: false } })
    await wrapper.find('button[data-settings-trigger]').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('open 时齿轮带 is-open 类', async () => {
    const wrapper = mount(TopBar, { props: { open: false } })
    const gear = wrapper.find('button[data-settings-trigger]')
    expect(gear.classes()).not.toContain('is-open')
    await wrapper.setProps({ open: true })
    expect(gear.classes()).toContain('is-open')
  })

  it('渲染重播按钮，点击 emit replay', async () => {
    const wrapper = mount(TopBar)
    const btn = wrapper.find('.replay-btn')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(wrapper.emitted('replay')).toHaveLength(1)
    wrapper.unmount()
  })

  it('静音按钮已删除', () => {
    const wrapper = mount(TopBar)
    expect(wrapper.find('.mute-btn').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('TopBar 播放/暂停', () => {
  it('按钮顺序为 播放/暂停 → 重播 → 齿轮', () => {
    const wrapper = mount(TopBar, { props: { playing: true } })
    const btns = wrapper.findAll('button')
    expect(btns).toHaveLength(3)
    expect(btns[0].classes()).toContain('play-btn')
    expect(btns[1].classes()).toContain('replay-btn')
    expect(btns[2].classes()).toContain('gear')
    wrapper.unmount()
  })

  it('playing=true 显示“暂停”与两条竖线图标，点击 emit toggle-play', async () => {
    const wrapper = mount(TopBar, { props: { playing: true } })
    const play = wrapper.find('.play-btn')
    expect(play.attributes('aria-label')).toBe('暂停')
    expect(play.findAll('svg line')).toHaveLength(2)
    expect(play.find('svg polygon').exists()).toBe(false)
    await play.trigger('click')
    expect(wrapper.emitted('toggle-play')).toHaveLength(1)
    wrapper.unmount()
  })

  it('playing=false 切换为“播放”与三角图标，恢复后切回', async () => {
    const wrapper = mount(TopBar, { props: { playing: false } })
    const play = wrapper.find('.play-btn')
    expect(play.attributes('aria-label')).toBe('播放')
    expect(play.find('svg polygon').exists()).toBe(true)
    expect(play.findAll('svg line')).toHaveLength(0)
    await wrapper.setProps({ playing: true })
    expect(play.attributes('aria-label')).toBe('暂停')
    expect(play.find('svg polygon').exists()).toBe(false)
    wrapper.unmount()
  })
})
