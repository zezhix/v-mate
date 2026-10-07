// src/utils/storage.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadJSON, saveJSON } from './storage'

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saveJSON 后 loadJSON 原样读回', () => {
    saveJSON('k', { a: 1, b: ['x'] })
    expect(loadJSON('k', null)).toEqual({ a: 1, b: ['x'] })
  })

  it('key 不存在时返回 fallback', () => {
    expect(loadJSON('missing', 'def')).toBe('def')
    expect(loadJSON('missing', null)).toBe(null)
  })

  it('存的是损坏 JSON 时返回 fallback', () => {
    localStorage.setItem('broken', '{not json')
    expect(loadJSON('broken', 'def')).toBe('def')
  })

  it('localStorage.getItem 抛异常（隐私模式）时返回 fallback', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadJSON('k', 'def')).toBe('def')
  })

  it('localStorage.setItem 抛异常时 saveJSON 不抛出', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => saveJSON('k', { a: 1 })).not.toThrow()
  })
})
