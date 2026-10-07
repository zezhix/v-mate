// src/components/ChatMode.test.js
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatMode from './ChatMode.vue'

const messages = [
  { role: 'user', text: '你好呀', time: 0 },
  { role: 'assistant', text: '嗨，我在呢', time: 3 },
  { role: 'user', text: '今天陪我聊聊', time: 8 },
]

function makeWrapper(props = {}) {
  return mount(ChatMode, {
    props: { messages, currentTime: 0, ...props },
    attachTo: document.body,
  })
}

describe('ChatMode', () => {
  it('只渲染 time <= currentTime 的消息', async () => {
    const wrapper = makeWrapper({ currentTime: 3 })
    const items = wrapper.findAll('.msg')
    expect(items).toHaveLength(2)
    expect(items[0].classes()).toContain('msg-user')
    expect(items[1].classes()).toContain('msg-assistant')
    await wrapper.setProps({ currentTime: 9 })
    expect(wrapper.findAll('.msg')).toHaveLength(3)
    wrapper.unmount()
  })

  it('currentTime 回到 0（视频循环）时只剩首条', async () => {
    const wrapper = makeWrapper({ currentTime: 10 })
    expect(wrapper.findAll('.msg')).toHaveLength(3)
    await wrapper.setProps({ currentTime: 0 })
    expect(wrapper.findAll('.msg')).toHaveLength(1)
    wrapper.unmount()
  })

  it('messages 为空时渲染空态文案', () => {
    const wrapper = makeWrapper({ messages: [] })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.findAll('.msg')).toHaveLength(0)
    wrapper.unmount()
  })

  it('消息内容正确渲染', () => {
    const wrapper = makeWrapper({ currentTime: 9 })
    const texts = wrapper.findAll('.msg').map((m) => m.find('.msg-text').text())
    expect(texts).toEqual(['你好呀', '嗨，我在呢', '今天陪我聊聊'])
    wrapper.unmount()
  })
})
