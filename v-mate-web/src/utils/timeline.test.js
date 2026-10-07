// src/utils/timeline.test.js
import { describe, it, expect } from 'vitest'
import { findCurrentIndex, parseScriptText, scriptToText } from './timeline'

describe('findCurrentIndex', () => {
  const times = [0, 5, 10, 20]

  it('空数组返回 -1', () => {
    expect(findCurrentIndex([], 3)).toBe(-1)
  })

  it('t 早于首个时间点时返回 0（首句兜底）', () => {
    expect(findCurrentIndex([5, 10], 1)).toBe(0)
  })

  it('返回不大于 t 的最后一个时间点下标', () => {
    expect(findCurrentIndex(times, 0)).toBe(0)
    expect(findCurrentIndex(times, 4.99)).toBe(0)
    expect(findCurrentIndex(times, 5)).toBe(1)
    expect(findCurrentIndex(times, 19.9)).toBe(1 + 1)
    expect(findCurrentIndex(times, 19.99)).toBe(2)
  })

  it('t 晚于末个时间点时返回末下标', () => {
    expect(findCurrentIndex(times, 999)).toBe(3)
  })

  it('视频循环重播 t 回到 0 时回到首句', () => {
    expect(findCurrentIndex(times, 0)).toBe(0)
  })
})

describe('parseScriptText', () => {
  it('按换行拆句并套用给定时间', () => {
    const result = parseScriptText('第一句\n第二句\n第三句', [0, 5, 10])
    expect(result).toEqual([
      { time: 0, text: '第一句' },
      { time: 5, text: '第二句' },
      { time: 10, text: '第三句' },
    ])
  })

  it('忽略空行', () => {
    const result = parseScriptText('第一句\n\n  \n第二句', [0, 5])
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.text)).toEqual(['第一句', '第二句'])
  })

  it('句数多于时间数时按末时间 +3s 步进补齐', () => {
    const result = parseScriptText('a\nb\nc', [0, 5])
    expect(result).toEqual([
      { time: 0, text: 'a' },
      { time: 5, text: 'b' },
      { time: 8, text: 'c' },
    ])
  })

  it('句数少于时间数时截断多余时间', () => {
    const result = parseScriptText('a', [0, 5, 10])
    expect(result).toEqual([{ time: 0, text: 'a' }])
  })

  it('全部为空行时返回空数组', () => {
    expect(parseScriptText('\n  \n', [0, 5])).toEqual([])
  })
})

describe('scriptToText', () => {
  it('按行拼回文本', () => {
    expect(scriptToText([{ time: 0, text: '甲' }, { time: 5, text: '乙' }])).toBe('甲\n乙')
  })

  it('空脚本返回空串', () => {
    expect(scriptToText([])).toBe('')
  })
})

// ── 追加到 src/utils/timeline.test.js ──
import { splitSentences, buildScript, lyricTime } from './timeline'

describe('splitSentences', () => {
  it('按中文句末标点与换行拆句，保留标点', () => {
    expect(splitSentences('你好。世界！\n嗯…')).toEqual(['你好。', '世界！', '嗯…'])
  })
})

describe('buildScript', () => {
  const ready = (index, text, duration) => ({ index, text, state: 'ready', duration })

  it('未就绪段不参与，段起点为前段时长累加', () => {
    const chunks = [
      ready(0, '第一句。', 3),
      { index: 1, text: '第二段', state: 'pending', duration: null },
      ready(2, '第三句。', 4),
    ]
    const script = buildScript(chunks)
    // 段 0 起点 0；段 2 起点 0+3（段 1 未就绪不占位）
    expect(script.map((s) => s.time)).toEqual([0, 3])
    expect(script.map((s) => s.text)).toEqual(['第一句。', '第三句。'])
  })

  it('段内多句按字数比例分配时长', () => {
    const script = buildScript([ready(0, '四个汉字。六个汉字句子内容。', 10)])
    expect(script).toHaveLength(2)
    expect(script[0].time).toBe(0)
    // 5 字 : 9 字 → 第二句起点 = 10 * 5/14（输入共 14 字）
    expect(script[1].time).toBeCloseTo((10 * 5) / 14, 5)
  })

  it('空任务与全未就绪返回空数组', () => {
    expect(buildScript([])).toEqual([])
    expect(buildScript([{ index: 0, text: 'x', state: 'tts', duration: null }])).toEqual([])
  })
})

describe('lyricTime', () => {
  const chunks = [
    { index: 0, state: 'ready', duration: 3 },
    { index: 1, state: 'ready', duration: 4 },
    { index: 2, state: 'pending', duration: null },
  ]

  it('播放中 = 段基址 + currentTime', () => {
    expect(lyricTime(chunks, 1, 1.5)).toBeCloseTo(4.5, 5)
    expect(lyricTime(chunks, 0, 2)).toBeCloseTo(2, 5)
  })

  it('兜底等待（playing=null）冻结在已完成段边界', () => {
    expect(lyricTime(chunks, null, 99)).toBeCloseTo(7, 5)   // 3 + 4
  })

  it('失败段无时长不占位', () => {
    const withFailed = [
      { index: 0, state: 'failed', duration: null },
      { index: 1, state: 'ready', duration: 2 },
    ]
    expect(lyricTime(withFailed, 1, 1)).toBeCloseTo(1, 5)    // 基址 0
    expect(lyricTime(withFailed, null, 5)).toBeCloseTo(2, 5)
  })
})
