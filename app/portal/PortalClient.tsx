'use client'
import { useEffect, useRef, useState } from 'react'
type Portal = {
  ticket: { id: string; subject: string; stage: string }
  messages: { id: string; body: string; from: string; createdAt: string }[]
  articles: { id: string; title: string; body: string }[]
}
export function PortalClient() {
  const signedOut = useRef(false)
  const [data, setData] = useState<Portal | null>(null),
    [error, setError] = useState(''),
    [body, setBody] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState('')
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      const response = await fetch('/api/portal', {
        signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok) {
        if (alive && [401, 403].includes(response.status)) setData(null)
        throw new Error(result.error)
      }
      if (alive && !signedOut.current) {
        setData(result)
        setError('')
      }
    }
    async function start() {
      const token = window.location.hash.slice(1)
      if (token) {
        window.history.replaceState(null, '', '/portal')
        const response = await fetch('/api/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sign-in', token }),
          signal: controller.signal,
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
      }
      await load()
    }
    async function poll(initial = false) {
      try {
        if (initial) await start()
        else if (document.visibilityState === 'visible') await load()
      } catch (e) {
        if (alive && !signedOut.current && (e as Error).name !== 'AbortError')
          setError((e as Error).message)
      } finally {
        if (alive && !signedOut.current) timer = setTimeout(() => void poll(), 15000)
      }
    }
    void poll(true)
    return () => {
      alive = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [])
  async function reply(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reply', body }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setBody('')
      const read = await fetch('/api/portal')
      const next = await read.json()
      if (!read.ok) {
        if ([401, 403].includes(read.status)) setData(null)
        throw new Error(next.error)
      }
      if (!signedOut.current) setData(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <header className="bg-[#0B1628] px-6 py-5 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-white/60">TicketingMadeEZ</p>
            <h1 className="mt-1 text-xl">Support portal</h1>
          </div>
          {data && (
            <button
              disabled={busy}
              className="rounded-lg border border-white/30 px-3 py-2 text-sm"
              onClick={async () => {
                if (busy) return
                setBusy(true)
                signedOut.current = true
                try {
                  const response = await fetch('/api/portal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'sign-out' }),
                  })
                  if (!response.ok) throw new Error('Unable to sign out. Please try again.')
                  setData(null)
                  setBody('')
                  setError('Signed out. Ask your support team for a new link to return.')
                } catch (e) {
                  signedOut.current = false
                  setError((e as Error).message)
                } finally { setBusy(false) }
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-5xl space-y-5 p-5 md:p-8">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Opening your support ticket...</p>}
        {data && (
          <>
            <section className="workspace-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="break-all text-xs text-ink/50">
                    Ticket {data.ticket.id}
                  </p>
                  <h2 className="mt-2 text-2xl">{data.ticket.subject}</h2>
                </div>
                <span className="rounded-full bg-cyan/15 px-3 py-1 text-sm">
                  {data.ticket.stage}
                </span>
              </div>
            </section>
            <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
              <section className="workspace-panel">
                <h2>Conversation</h2>
                <p className="mt-1 text-xs text-ink/50">
                  Messages refresh while this page is open. Your support team
                  replies here.
                </p>
                <ol className="my-5 space-y-4">
                  {data.messages
                    .slice()
                    .reverse()
                    .map((m) => (
                      <li
                        key={m.id}
                        className={
                          'rounded-xl border p-3 ' +
                          (m.from === 'Support team'
                            ? 'border-cyan/30 bg-cyan/5'
                            : 'border-ink/10')
                        }
                      >
                        <p className="text-xs font-semibold">
                          {m.from} · {new Date(m.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                          {m.body}
                        </p>
                      </li>
                    ))}
                </ol>
                {!data.messages.length && (
                  <p className="my-5 text-sm text-ink/50">
                    Send a message to add details to your request.
                  </p>
                )}
                <form onSubmit={reply} className="space-y-3">
                  <label className="block text-sm" htmlFor="customer-reply">
                    Your message
                  </label>
                  <textarea
                    id="customer-reply"
                    className="w-full rounded-lg border border-ink/20 bg-white p-3 text-sm"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    required
                    maxLength={10000}
                    rows={4}
                  />
                  <button
                    disabled={busy || !body.trim()}
                    className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? 'Sending...' : 'Send message'}
                  </button>
                </form>
              </section>
              <section className="workspace-panel">
                <h2>Help articles</h2>
                <label className="mt-3 block text-xs">
                  Search answers
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink/20 bg-white p-2 text-sm"
                    type="search"
                  />
                </label>
                <div className="mt-4 space-y-3">
                  {data.articles
                    .filter((a) =>
                      (a.title + ' ' + a.body)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((a) => (
                      <details
                        key={a.id}
                        className="rounded-lg border border-ink/10 p-3"
                      >
                        <summary className="cursor-pointer text-sm font-semibold">
                          {a.title}
                        </summary>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-ink/70">
                          {a.body}
                        </p>
                      </details>
                    ))}
                </div>
                {!data.articles.length && (
                  <p className="mt-3 text-sm text-ink/50">
                    No help articles have been published yet.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
        <footer className="text-xs text-ink/40">
          Powered by TicketingMadeEZ · NexBDM™
        </footer>
      </div>
    </main>
  )
}
