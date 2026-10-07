// src/utils/timeline.js

/**
 * 返回时刻 t 应高亮的脚本下标。
 * @param {number[]} times 升序时间点（秒）
 * @param {number} t 当前播放秒数
 * @returns {number} 下标；times 为空返回 -1
 */
export function findCurrentIndex(times, t) {
  if (!times.length) return -1
  if (t < times[0]) return 0
  let idx = 0
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= t) idx = i
    else break
  }
  return idx
}

/**
 * 把用户输入的多行口播文本解析为带时间轴的脚本。
 * 句数与 fallbackTimes 不一致时：多出的句子按「末时间 + 3s」步进补齐，
 * 少于则截断。fallbackTimes 为空时全部落在 0 秒。
 * @param {string} text
 * @param {number[]} fallbackTimes
 */
export function parseScriptText(text, fallbackTimes) {
  const lines = String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) return []
  if (!fallbackTimes.length) return lines.map((line) => ({ time: 0, text: line }))

  return lines.map((line, i) => {
    if (i < fallbackTimes.length) return { time: fallbackTimes[i], text: line }
    const last = fallbackTimes[fallbackTimes.length - 1]
    return { time: last + 3 * (i - fallbackTimes.length + 1), text: line }
  })
}

/**
 * 脚本拼回多行文本，供设置浮层 textarea 回填。
 * @param {{time: number, text: string}[]} script
 */
export function scriptToText(script) {
  return script.map((item) => item.text).join('\n')
}

// ── 口播流水线时间轴（由生成视频各段实测时长构建） ──

const SENTENCE_END = /(?<=[。！？；!?;…])|\n+/

/** 与后端 splitter 同规则拆句（保留句末标点、丢弃换行）。 */
export function splitSentences(text) {
  return String(text).split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)
}

/**
 * 由各段信息构建歌词时间轴。仅 ready 段参与；段内按字数比例分配时长。
 * @param {{index:number,text:string,state:string,duration:number|null}[]} chunks
 * @returns {{time:number,text:string}[]}
 */
export function buildScript(chunks) {
  const script = []
  let base = 0
  const ordered = [...chunks].sort((a, b) => a.index - b.index)
  for (const chunk of ordered) {
    if (chunk.state !== 'ready' || !chunk.duration) continue
    const sentences = splitSentences(chunk.text)
    const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1
    let offset = 0
    for (const sentence of sentences) {
      script.push({ time: base + offset, text: sentence })
      offset += chunk.duration * (sentence.length / totalChars)
    }
    base += chunk.duration
  }
  return script
}

/**
 * 歌词用的全局时间：播放中 = 段基址 + currentTime；兜底/等待冻结在段边界。
 * @param {Array} chunks 同 buildScript
 * @param {number|null} playing 正在播放的段号，null 表示兜底
 * @param {number} currentTime <video>.currentTime
 */
export function lyricTime(chunks, playing, currentTime) {
  const ordered = [...chunks].sort((a, b) => a.index - b.index)
  const baseOf = (i) =>
    ordered
      .filter((c) => c.index < i && c.state === 'ready' && c.duration)
      .reduce((n, c) => n + c.duration, 0)
  if (playing === null) {
    // 冻结在等待段的起点（即所有已播完段的总时长）
    const waitingIndex = ordered.reduce(
      (n, c) => (c.state === 'ready' || c.state === 'failed' ? Math.max(n, c.index + 1) : n),
      0)
    return baseOf(waitingIndex)
  }
  return baseOf(playing) + currentTime
}
