const API_BASE = 'http://127.0.0.1:8000'

// fetch() has no native timeout — abort via AbortController so a dead
// backend surfaces as a clear error instead of hanging the UI
function timedFetch(url, options = {}, ms = 15_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer)
  )
}

export async function uploadDataset(file) {
  const formData = new FormData()
  formData.append('file', file)
  let res
  try {
    res = await timedFetch(`${API_BASE}/upload`, { method: 'POST', body: formData })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Upload timed out — is the backend running?')
    throw new Error('Cannot reach the server — is the backend running?')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? 'Upload failed')
  }
  return res.json()
}

export async function fetchRows({ limit = 100, offset = 0 } = {}) {
  const url = new URL(`${API_BASE}/rows`)
  url.searchParams.set('limit', limit)
  url.searchParams.set('offset', offset)
  let res
  try {
    res = await timedFetch(url)
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out')
    throw new Error('Cannot reach the server — is the backend running?')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? 'Failed to fetch rows')
  }
  return res.json()
}

export async function askQuestion(question) {
  let res
  try {
    res = await timedFetch(
      `${API_BASE}/ask`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) },
      60_000   // LLM calls can take longer
    )
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out — the AI took too long to respond')
    throw new Error('Cannot reach the server — is the backend running?')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(body.detail ?? 'Ask failed')
  }
  return res.json()
}
