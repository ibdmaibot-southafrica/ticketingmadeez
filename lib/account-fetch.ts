'use client'

let renewal: Promise<boolean> | undefined

// Reauthenticate through the CRM after a definite 401. Never replay an ambiguous
// network failure or change the requested account during a retry.
async function renewSession(locationId: string) {
  if (renewal) return renewal
  renewal = new Promise<boolean>((resolve) => {
    if (window.parent === window) { resolve(false); return }
    let finished = false
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      window.removeEventListener('message', listener)
      resolve(ok)
    }
    const listener = async (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.message !== 'REQUEST_USER_DATA_RESPONSE' || typeof event.data.payload !== 'string') return
      window.removeEventListener('message', listener)
      try {
        const response = await fetch('/api/auth/session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedData: event.data.payload }), signal: AbortSignal.timeout(60000),
        })
        const data = await response.json()
        finish(response.ok && data.locationId === locationId)
      } catch { finish(false) }
    }
    const timer = setTimeout(() => finish(false), 60000)
    window.addEventListener('message', listener)
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
  }).finally(() => { renewal = undefined })
  return renewal
}

export async function accountFetch(input: string, init?: RequestInit) {
  const response = await fetch(input, init)
  if (response.status !== 401 || init?.signal?.aborted) return response
  const url = new URL(input, window.location.origin)
  const locationId = new URLSearchParams(window.location.search).get('locationId')
  if (!locationId || url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return response
  if (!await renewSession(locationId) || init?.signal?.aborted) return response
  return fetch(input, init)
}
