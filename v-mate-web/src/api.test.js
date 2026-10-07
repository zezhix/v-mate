// src/api.test.js — HTTP 薄封装的边界：404→null（无历史任务）、200→json、5xx→抛错
import { describe, it, expect, vi } from 'vitest'
import { getCurrentJob } from './api'

describe('api.getCurrentJob', () => {
  it('404 → null（后端无历史任务，不算错误）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }))
    expect(await getCurrentJob({ fetchImpl })).toBeNull()
  })

  it('200 → 返回快照 json，请求 /api/jobs/current', async () => {
    const job = { id: 'j1', state: 'done', chunks: [] }
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => job,
    }))
    expect(await getCurrentJob({ fetchImpl })).toEqual(job)
    expect(fetchImpl).toHaveBeenCalledWith('/api/jobs/current')
  })

  it('500 → 抛错（调用方按不可用处理）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }))
    await expect(getCurrentJob({ fetchImpl })).rejects.toThrow('HTTP 500')
  })
})
