// src/api.js — 后端 HTTP/SSE 薄封装（依赖可注入，便于测试）

const defaultFetch = (...args) => globalThis.fetch(...args)   // 保持 this 绑定，避免 Illegal invocation

export async function createJob(text, { fetchImpl = defaultFetch } = {}) {
  const res = await fetchImpl('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`创建口播任务失败: HTTP ${res.status}`)
  return res.json()
}

export async function getJob(id, { fetchImpl = defaultFetch } = {}) {
  const res = await fetchImpl(`/api/jobs/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`查询任务失败: HTTP ${res.status}`)
  return res.json()
}

/** 最近一次任务的快照；后端无历史任务（404）→ null，不算错误。 */
export async function getCurrentJob({ fetchImpl = defaultFetch } = {}) {
  const res = await fetchImpl('/api/jobs/current')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`查询最近任务失败: HTTP ${res.status}`)
  return res.json()
}

export function openEvents(id, { onEvent, onError, eventSourceImpl } = {}) {
  const Ctor = eventSourceImpl || globalThis.EventSource
  const es = new Ctor(`/api/jobs/${encodeURIComponent(id)}/events`)
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data))
    } catch {
      /* 忽略无法解析的帧 */
    }
  }
  es.onerror = () => onError?.(es)
  return () => es.close()
}
