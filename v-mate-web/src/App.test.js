import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from './App.vue'
import * as api from './api'
import defaultScript from './mock/script.json'
import defaultMessages from './mock/messages.json'

// 包一层 spy：getCurrentJob 可断言/控制返回，其余（createJob/openEvents）保持真实现
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getCurrentJob: vi.fn(actual.getCurrentJob) }
})

describe('App 布局骨架', () => {
  it('渲染两栏布局的三个区域', () => {
    const wrapper = mount(App)
    expect(wrapper.find('.layout').exists()).toBe(true)
    expect(wrapper.find('.content-area').exists()).toBe(true)
    expect(wrapper.find('.video-area').exists()).toBe(true)
  })

  it('顶部只有齿轮按钮，无标题文字', () => {
    const wrapper = mount(App)
    const topBar = wrapper.find('.top-bar')
    expect(topBar.find('button').exists()).toBe(true)
    expect(topBar.text().trim()).toBe('')
  })
})

describe('App 集成', () => {
  it('默认口播模式：渲染歌词，且 localStorage 无脏数据', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.findComponent({ name: 'LiveLyricsMode' }).exists() || wrapper.find('.lyric-list').exists()).toBe(true)
    expect(wrapper.find('.lyric-line').exists()).toBe(true)
    wrapper.unmount()
  })

  it('localStorage 存有 chat 模式时以对话模式启动', async () => {
    localStorage.setItem('vmate.mode', JSON.stringify('chat'))
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.find('.chat').exists()).toBe(true)
    wrapper.unmount()
    localStorage.clear()
  })

  it('localStorage 存的是损坏 JSON 时回退默认模式', async () => {
    localStorage.setItem('vmate.mode', '{broken')
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.find('.lyric-list').exists()).toBe(true)
    wrapper.unmount()
    localStorage.clear()
  })

  it('切换到对话模式后视频组件仍挂载（同一元素）', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })
    const videoBefore = wrapper.find('video').element

    // 适配：SettingsPanel 为 v-if，.mode-btn 在浮层关闭时不存在，先点齿轮打开
    await wrapper.find('.gear').trigger('click')
    await wrapper.findAll('.mode-btn')[1].trigger('click')

    expect(wrapper.find('video').element).toBe(videoBefore)
    expect(wrapper.find('.chat').exists()).toBe(true)
    wrapper.unmount()
  })

  it('口播内容确认后写入 localStorage 并更新歌词', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })

    await wrapper.find('.gear').trigger('click')
    await wrapper.find('textarea').setValue('新台词一\n新台词二')
    await wrapper.find('.confirm-btn').trigger('click')

    expect(JSON.parse(localStorage.getItem('vmate.script'))).toEqual([
      { time: defaultScript[0].time, text: '新台词一' },
      { time: defaultScript[1].time, text: '新台词二' },
    ])
    expect(wrapper.findAll('.lyric-line').map((l) => l.text())).toEqual(['新台词一', '新台词二'])
    wrapper.unmount()
    localStorage.clear()
  })

  it('未确认的编辑不影响已渲染歌词', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })

    await wrapper.find('.gear').trigger('click')
    await wrapper.find('textarea').setValue('没确认的文本')
    expect(wrapper.find('.lyric-line').text()).not.toBe('没确认的文本')
    expect(wrapper.find('.settings-panel').exists()).toBe(true)

    // 适配：面板内 mousedown 不会关闭自己（组件有意忽略），改为在 document.body 上派发
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(wrapper.find('.settings-panel').exists()).toBe(false)
    expect(wrapper.find('.lyric-line').text()).toBe(defaultScript[0].text)
    wrapper.unmount()
    localStorage.clear()
  })

  it('视频加载失败时显示占位，歌词区仍可用', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })

    await wrapper.find('video').trigger('error')

    expect(wrapper.find('.video-error').exists()).toBe(true)
    expect(wrapper.find('.lyric-list').exists()).toBe(true)
    expect(defaultMessages.length).toBeGreaterThan(0)
    wrapper.unmount()
    localStorage.clear()
  })

  it('默认暂停；点播放后带声播放，再点暂停', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })
    const video = wrapper.find('video').element
    const btn = wrapper.find('.play-btn')
    const calls = { pause: 0, play: 0 }
    video.pause = () => { calls.pause += 1 }
    video.play = () => { calls.play += 1 }

    expect(btn.attributes('aria-label')).toBe('播放')          // 默认暂停
    expect(video.muted).toBe(true)                             // 尚未开始播放保持静音
    expect(localStorage.getItem('vmate.muted')).toBeNull()      // 静音偏好不再持久化

    await btn.trigger('click')                                 // → 带声播放
    expect(calls.play).toBe(1)
    expect(video.muted).toBe(false)
    expect(btn.attributes('aria-label')).toBe('暂停')

    await btn.trigger('click')                                 // → 暂停
    expect(calls.pause).toBe(1)
    expect(btn.attributes('aria-label')).toBe('播放')
    wrapper.unmount()
    localStorage.clear()
  })

  it('点重播按钮：无任务时兜底从头播、带声、进入播放态', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })
    const video = wrapper.find('video').element
    const calls = { play: 0 }
    video.play = () => { calls.play += 1 }

    await wrapper.find('.replay-btn').trigger('click')

    expect(video.muted).toBe(false)                            // 重播即带声
    expect(calls.play).toBeGreaterThanOrEqual(1)                // 开始播放
    expect(wrapper.find('.play-btn').attributes('aria-label')).toBe('暂停')
    wrapper.unmount()
    localStorage.clear()
  })

  it('顶栏无静音按钮（已由重播按钮替换）', async () => {
    localStorage.clear()
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.find('.mute-btn').exists()).toBe(false)
    expect(wrapper.find('.replay-btn').exists()).toBe(true)
    wrapper.unmount()
    localStorage.clear()
  })

  it('重播：先播兜底，3 秒后才接入口播段', async () => {
    localStorage.clear()
    api.getCurrentJob.mockResolvedValueOnce({ id: 'j2', state: 'done', chunks: [
      { index: 0, text: '第一句。', state: 'ready', duration: 2,
        url: '/media/j2/seg_000.mp4' },
    ] })
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => {})
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const src = () => wrapper.find('video').attributes('src')
    expect(src()).not.toContain('seg_000')                            // 刷新先展示兜底

    vi.useFakeTimers()
    try {
      await wrapper.find('.play-btn').trigger('click')                // 起播 → 3 秒后接入
      vi.advanceTimersByTime(3000)
      await nextTick()
      expect(src()).toContain('/media/j2/seg_000.mp4')

      await wrapper.find('.replay-btn').trigger('click')
      expect(src()).not.toContain('seg_000')                          // 重播兜底先行
      vi.advanceTimersByTime(2999)
      await nextTick()
      expect(src()).not.toContain('seg_000')                          // 未到 3 秒
      vi.advanceTimersByTime(1)
      await nextTick()
      expect(src()).toContain('/media/j2/seg_000.mp4')                // 到点接入
    } finally {
      vi.useRealTimers()
      wrapper.unmount()
      playSpy.mockRestore()
      pauseSpy.mockRestore()
      localStorage.clear()
    }
  })

  it('重播倒计时中点暂停 → 不切段；恢复播放立即接入口播段', async () => {
    localStorage.clear()
    api.getCurrentJob.mockResolvedValueOnce({ id: 'j3', state: 'done', chunks: [
      { index: 0, text: '第一句。', state: 'ready', duration: 2,
        url: '/media/j3/seg_000.mp4' },
    ] })
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => {})
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const src = () => wrapper.find('video').attributes('src')

    vi.useFakeTimers()
    try {
      await wrapper.find('.replay-btn').trigger('click')
      vi.advanceTimersByTime(1000)
      await wrapper.find('.play-btn').trigger('click')                  // 暂停
      vi.advanceTimersByTime(10000)                                     // 跨过截止时刻
      await nextTick()
      expect(src()).not.toContain('seg_000')                            // 暂停不切段
      await wrapper.find('.play-btn').trigger('click')                  // 恢复播放
      await nextTick()
      expect(src()).toContain('/media/j3/seg_000.mp4')                  // 截止已过 → 立即接入
    } finally {
      vi.useRealTimers()
      wrapper.unmount()
      playSpy.mockRestore()
      pauseSpy.mockRestore()
      localStorage.clear()
    }
  })

  it('无口播任务点重播：歌词定位到第一句', async () => {
    localStorage.clear()
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => {})
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const wrapper = mount(App, { attachTo: document.body })
    const video = wrapper.find('video')
    Object.defineProperty(video.element, 'currentTime', { value: 12.5, configurable: true })
    await video.trigger('timeupdate')
    await nextTick()
    expect(wrapper.findAll('.lyric-line').at(2).classes()).toContain('is-current')  // t=12.5 → 第三句

    await wrapper.find('.replay-btn').trigger('click')
    await nextTick()
    const current = wrapper.findAll('.lyric-line.is-current')
    expect(current).toHaveLength(1)
    expect(current.at(0).text()).toBe(defaultScript[0].text)            // 第一句
    wrapper.unmount()
    playSpy.mockRestore()
    pauseSpy.mockRestore()
    localStorage.clear()
  })

  it('口播任务点重播：3 秒兜底期间歌词高亮第一句', async () => {
    localStorage.clear()
    api.getCurrentJob.mockResolvedValueOnce({ id: 'j4', state: 'done', chunks: [
      { index: 0, text: '第一句。', state: 'ready', duration: 2,
        url: '/media/j4/seg_000.mp4' },
      { index: 1, text: '第二句。', state: 'ready', duration: 3,
        url: '/media/j4/seg_001.mp4' },
    ] })
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => {})
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const video = wrapper.find('video')
    Object.defineProperty(video.element, 'currentTime', { value: 2.5, configurable: true })
    const isCurrent = () => wrapper.findAll('.lyric-line.is-current')
    expect(isCurrent()).toHaveLength(1)
    expect(isCurrent().at(0).text()).toBe('第一句。')                 // 刷新即定位第一句

    vi.useFakeTimers()
    try {
      await wrapper.find('.play-btn').trigger('click')              // 起播 → 3 秒后接入
      vi.advanceTimersByTime(3000)
      await nextTick()
      await video.trigger('timeupdate')                            // 段 0 播到 2.5s
      await nextTick()
      expect(isCurrent().at(0).text()).toBe('第二句。')               // 正常推进

      await wrapper.find('.replay-btn').trigger('click')
      await nextTick()
      expect(isCurrent()).toHaveLength(1)
      expect(isCurrent().at(0).text()).toBe('第一句。')               // 重播即第一句
      vi.advanceTimersByTime(2000)
      await nextTick()
      expect(isCurrent().at(0).text()).toBe('第一句。')               // 兜底期间保持
    } finally {
      vi.useRealTimers()
      wrapper.unmount()
      playSpy.mockRestore()
      pauseSpy.mockRestore()
      localStorage.clear()
    }
  })

  it('页面加载自动恢复最近任务：先展示兜底、歌词同源、起播后接入', async () => {
    localStorage.clear()
    api.getCurrentJob.mockResolvedValueOnce({ id: 'j2', state: 'done', chunks: [
      { index: 0, text: '恢复的第一句', state: 'ready', duration: 2,
        url: '/media/j2/seg_000.mp4' },
      { index: 1, text: '中断的第二句', state: 'failed', duration: null, url: null },
    ] })
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})                        // jsdom 未实现 pause，仅消噪
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    expect(api.getCurrentJob).toHaveBeenCalled()
    expect(wrapper.find('video').attributes('src'))
      .not.toContain('seg_000')                             // 刷新先展示兜底
    expect(wrapper.find('.lyric-line').text()).toBe('恢复的第一句')  // 歌词与任务同源
    expect(wrapper.find('.progress-badge').exists()).toBe(false)     // 终态不出生成中
    wrapper.unmount()
    pauseSpy.mockRestore()
    localStorage.clear()
  })

  it('刷新后先展示兜底，点播放 3 秒后才接入口播段', async () => {
    localStorage.clear()
    api.getCurrentJob.mockResolvedValueOnce({ id: 'j5', state: 'done', chunks: [
      { index: 0, text: '恢复的第一句', state: 'ready', duration: 2,
        url: '/media/j5/seg_000.mp4' },
      { index: 1, text: '恢复的第二句', state: 'ready', duration: 3,
        url: '/media/j5/seg_001.mp4' },
    ] })
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => {})
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {})
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const src = () => wrapper.find('video').attributes('src')
    expect(src()).not.toContain('seg_000')                             // 刷新先展示兜底
    const current = wrapper.findAll('.lyric-line.is-current')
    expect(current).toHaveLength(1)
    expect(current.at(0).text()).toBe('恢复的第一句')                  // 歌词定位第一句

    vi.useFakeTimers()
    try {
      await wrapper.find('.play-btn').trigger('click')                  // 起播（用户手势）
      await nextTick()
      expect(src()).not.toContain('seg_000')                            // 3 秒内仍是兜底
      vi.advanceTimersByTime(3000)
      await nextTick()
      expect(src()).toContain('/media/j5/seg_000.mp4')                  // 到点接入
    } finally {
      vi.useRealTimers()
      wrapper.unmount()
      playSpy.mockRestore()
      pauseSpy.mockRestore()
      localStorage.clear()
    }
  })
})
