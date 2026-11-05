'use client'
import { useEffect, useState } from 'react'
export default function AuthPage() {
  const [message, setMessage] = useState('Verifying account access...')
  useEffect(() => {
    let active = true
    const timer = setTimeout(
      () =>
        setMessage('Open TicketingMadeEZ inside your CRM to sign in securely.'),
      15000,
    )
    const listener = async (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.source === window ||
        event.data?.message !== 'REQUEST_USER_DATA_RESPONSE' ||
        typeof event.data.payload !== 'string'
      )
        return
      window.removeEventListener('message', listener)
      try {
        const r = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedData: event.data.payload }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        if (!active) return
        const next =
          new URLSearchParams(window.location.search).get('next') ||
          (window.location.pathname.startsWith('/settings')
            ? window.location.pathname + window.location.search
            : '/settings')
        const target = new URL(next, window.location.origin)
        if (
          target.origin !== window.location.origin ||
          !target.pathname.startsWith('/settings')
        )
          throw new Error('Invalid destination')
        target.searchParams.set('locationId', data.locationId)
        window.location.replace(target.toString())
      } catch {
        if (active)
          setMessage(
            'Secure sign-in failed. Reopen the app inside your CRM or contact support.',
          )
      }
    }
    window.addEventListener('message', listener)
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    return () => {
      active = false
      clearTimeout(timer)
      window.removeEventListener('message', listener)
    }
  }, [])
  return (
    <main className="p-8">
      <h1>TicketingMadeEZ</h1>
      <p>{message}</p>
    </main>
  )
}
