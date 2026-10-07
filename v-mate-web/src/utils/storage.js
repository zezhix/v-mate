// src/utils/storage.js

/**
 * 安全读取 localStorage 中的 JSON。
 * 缺失、损坏、或 localStorage 不可用（隐私模式抛异常）时返回 fallback。
 * @param {string} key
 * @param {*} fallback
 */
export function loadJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null || raw === undefined) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/**
 * 安全写入 localStorage，任何异常静默忽略。
 * @param {string} key
 * @param {*} value
 */
export function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额满：忽略 */
  }
}
