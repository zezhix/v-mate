// src/components/SettingsPanel.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SettingsPanel from './SettingsPanel.vue'

function mountPanel(props = {}) {
  return mount(SettingsPanel, {
    props: {
      open: true,
      mode: 'live',
      scriptText: '第一句\n第二句',
      ...props,
    },
    attachTo: document.body,
  })
}

describe('SettingsPanel', () => {
  it('open=false 时不渲染面板', () => {
    const wrapper = mountPanel({ open: false })
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('open=true 时渲染模式切换与口播输入', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.settings-panel').exists()).toBe(true)
    expect(wrapper.findAll('.mode-btn')).toHaveLength(2)
    expect(wrapper.find('textarea').element.value).toBe('第一句\n第二句')
    wrapper.unmount()
  })

  it('当前模式按钮高亮', () => {
    const wrapper = mountPanel({ mode: 'chat' })
    const btns = wrapper.findAll('.mode-btn')
    expect(btns[0].classes()).not.toContain('is-active')
    expect(btns[1].classes()).toContain('is-active')
    wrapper.unmount()
  })

  it('点击模式按钮 emit update:mode', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.mode-btn')[1].trigger('click')
    expect(wrapper.emitted('update:mode')[0]).toEqual(['chat'])
    wrapper.unmount()
  })

  it('编辑文本但未点确认时不 emit confirm', async () => {
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('改了但没确认')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })

  it('点确认 emit confirm 携带文本并 emit close', async () => {
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('新的口播内容')
    await wrapper.find('.confirm-btn').trigger('click')
    expect(wrapper.emitted('confirm')[0]).toEqual(['新的口播内容'])
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('面板外 mousedown 触发 close，齿轮按钮上不触发', async () => {
    const wrapper = mountPanel()
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    const trigger = document.createElement('button')
    trigger.setAttribute('data-settings-trigger', '')
    document.body.appendChild(trigger)
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    outside.remove()
    trigger.remove()
    wrapper.unmount()
  })

  it('Esc 键触发 close', async () => {
    const wrapper = mountPanel()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('scriptText 变化时回填 textarea', async () => {
    const wrapper = mountPanel({ scriptText: '旧内容' })
    await wrapper.setProps({ scriptText: '新内容' })
    expect(wrapper.find('textarea').element.value).toBe('新内容')
    wrapper.unmount()
  })
})
