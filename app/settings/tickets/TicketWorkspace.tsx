'use client'

import { useEffect, useRef, useState } from 'react'
import type { Ticket } from '@/lib/ghl-data'
import type { Activity, TicketDetails, TicketFile } from '@/lib/workspace-store'
import { ticketSla, type SlaPolicy } from '@/lib/ticket-sla'

type Workspace = {
  ticket: Ticket
  details: TicketDetails
  activity: Activity[]
  files: TicketFile[]
  stages: { id: string; name: string }[]
  users: { id: string; name: string }[]
  department: string
  sla?: SlaPolicy
  admin: boolean
}
const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan/50'
const action =
  'rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
export function TicketWorkspace({
  locationId,
  ticketId,
  onClose,
  onUpdated,
}: {
  locationId: string
  ticketId: string
  onClose: () => void
  onUpdated: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [data, setData] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState('')
  const [reply, setReply] = useState('')
  const [portalLink, setPortalLink] = useState('')
  const [grants, setGrants] = useState<
    { id: string; expiresAt: string; revoked: boolean; consumed: boolean }[]
  >([])
  const [revision, setRevision] = useState(0)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const prefix = `/api/tickets/${encodeURIComponent(ticketId)}`
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy)
        setRevision((n) => n + 1)
    }, 15000)
    return () => clearInterval(timer)
  }, [busy])
  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    fetch(`${prefix}/workspace?locationId=${encodeURIComponent(locationId)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const result = await r.json()
        if (!r.ok) throw new Error(result.error || 'Ticket unavailable')
        return result
      })
      .then((result) => {
        setData(result)
        setLoadState('ready')
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError(e.message)
          setLoadState('error')
        }
      })
    return () => controller.abort()
  }, [prefix, locationId, revision])
  async function mutate(
    path: string,
    body: Record<string, unknown>,
    method = 'POST',
    message = 'Saved',
  ) {
    if (busy) return false
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const response = await fetch(prefix + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, ...body }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to save')
      setSaved(message)
      setRevision((n) => n + 1)
      onUpdated()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  async function upload(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError('Choose a file of 2 MB or less.')
      return
    }
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Cannot read this file'))
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.readAsDataURL(file)
      })
      await mutate(
        '/files',
        {
          name: file.name,
          mime: file.type || (file.name.endsWith('.txt') ? 'text/plain' : ''),
          content,
        },
        'POST',
        'File attached',
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function portalAccess(revokeId?: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch(prefix + '/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, revokeId }),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error)
      if (result.url) setPortalLink(result.url)
      const list = await fetch(
        `${prefix}/portal?locationId=${encodeURIComponent(locationId)}`,
      )
      const grants = await list.json()
      if (!list.ok) throw new Error(grants.error)
      setGrants(grants.grants)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const sla = data
    ? ticketSla({ ...data.ticket, ...data.details, sla: data.sla })
    : null
  return (
    <dialog
      ref={dialog}
      aria-labelledby="ticket-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
      className="m-auto w-[min(960px,96vw)] max-h-[94vh] rounded-2xl border border-ink/15 bg-slate-50 p-0 text-ink shadow-2xl backdrop:bg-ink/50"
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink/10 bg-white p-5">
        <div className="min-w-0">
          <p className="text-xs text-ink/50 break-all">Ticket {ticketId}</p>
          <h2 id="ticket-title" className="mt-1 text-xl">
            {data?.ticket.subject || 'Ticket workspace'}
          </h2>
          <p className="mt-1 text-sm text-ink/60">
            {data?.department}
            {data?.ticket.contactName ? ` · ${data.ticket.contactName}` : ''}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm"
        >
          Close
        </button>
      </header>
      <div className="p-5">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="mb-4 text-sm text-emerald">
            {saved}
          </p>
        )}
        {!data && loadState === 'loading' && (
          <p role="status">Loading ticket details...</p>
        )}
        {loadState === 'error' && (
          <button
            type="button"
            className={action}
            onClick={() => setRevision((n) => n + 1)}
          >
            Retry loading
          </button>
        )}
        {data && (
          <div className="grid gap-6 md:grid-cols-[1fr_260px]">
            <div className="min-w-0 space-y-5">
              <section className="workspace-panel">
                <h3>Description</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink/70">
                  {data.ticket.description || 'No description was supplied.'}
                </p>
                <p className="mt-3 text-xs text-ink/50">
                  Created {new Date(data.ticket.createdAt).toLocaleString()}
                </p>
              </section>
              <section className="workspace-panel">
                <h3>Customer conversation</h3>
                <p className="mt-1 text-xs text-ink/50">
                  Replies are visible in this ticket's support portal. No email
                  or SMS is sent.
                </p>
                <ol className="my-4 space-y-3">
                  {data.activity
                    .filter(
                      (a) =>
                        a.kind === 'customer-reply' || a.kind === 'team-reply',
                    )
                    .slice()
                    .reverse()
                    .map((a) => (
                      <li
                        key={a.id}
                        className="rounded-lg border border-ink/10 p-3"
                      >
                        <p className="text-xs text-ink/50">
                          {a.kind === 'team-reply'
                            ? 'Support team'
                            : 'Customer'}{' '}
                          · {new Date(a.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                          {a.body}
                        </p>
                      </li>
                    ))}
                </ol>
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (
                      await mutate(
                        '/workspace',
                        { action: 'reply', body: reply },
                        'POST',
                        'Reply posted to the support portal',
                      )
                    )
                      setReply('')
                  }}
                >
                  <label htmlFor="portal-reply" className="text-xs">
                    Reply in portal
                  </label>
                  <textarea
                    id="portal-reply"
                    className={field}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    required
                    rows={3}
                    maxLength={10000}
                  />
                  <button className={action} disabled={busy || !reply.trim()}>
                    Post portal reply
                  </button>
                </form>
              </section>
              <section className="workspace-panel">
                <h3>Internal notes</h3>
                <p className="mt-1 text-xs text-ink/50">
                  For your account team. Notes do not send a customer message or
                  count as a first response.
                </p>
                <form
                  className="mt-3 space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (
                      await mutate(
                        '/workspace',
                        { action: 'note', body: note },
                        'POST',
                        'Internal note added',
                      )
                    )
                      setNote('')
                  }}
                >
                  <label htmlFor="ticket-note" className="sr-only">
                    Internal note
                  </label>
                  <textarea
                    id="ticket-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={10000}
                    required
                    rows={4}
                    className={field}
                    placeholder="Add context for your team"
                  />
                  <button className={action} disabled={busy || !note.trim()}>
                    Add internal note
                  </button>
                </form>
              </section>
              <section className="workspace-panel">
                <h3>Files</h3>
                <p className="mt-1 text-xs text-ink/50">
                  PDF, PNG, JPEG or text. Up to 2 MB each, 20 files per ticket.
                  Downloads require account access.
                </p>
                <label className="mt-3 block text-sm">
                  Attach a file
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.txt"
                    disabled={busy}
                    className="mt-2 block w-full text-xs"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void upload(file)
                      e.target.value = ''
                    }}
                  />
                </label>
                <ul className="mt-3 space-y-2">
                  {data.files.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <a
                        className="truncate underline"
                        href={`${prefix}/files?locationId=${encodeURIComponent(locationId)}&fileId=${encodeURIComponent(f.id)}`}
                        download={f.name}
                      >
                        {f.name}
                      </a>
                      <span className="shrink-0 text-xs text-ink/50">
                        {Math.ceil(f.size / 1024)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="workspace-panel">
                <h3>Activity history</h3>
                <p className="mt-1 text-xs text-ink/50">
                  Updates recorded in TicketingMadeEZ. Older HighLevel changes
                  are not reconstructed.
                </p>
                {!data.activity.length && (
                  <p className="mt-3 text-sm text-ink/50">
                    No activity recorded here yet.
                  </p>
                )}
                <ol className="mt-4 space-y-4">
                  {data.activity.map((a) => (
                    <li key={a.id} className="border-l-2 border-cyan/40 pl-3">
                      <p className="text-xs text-ink/50">
                        {a.actorName} · {new Date(a.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                        {a.body}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <aside className="space-y-4">
              {data.admin && (
                <section className="workspace-panel">
                  <h3>Customer portal access</h3>
                  <p className="my-3 text-xs text-ink/60">
                    A one-use link grants access to this ticket's conversation
                    and published help articles for seven days. Share only with
                    the intended customer. Staff notes and files stay private.
                  </p>
                  <button
                    type="button"
                    className={action}
                    disabled={busy}
                    onClick={() => void portalAccess()}
                  >
                    Create customer access link
                  </button>
                  {portalLink && (
                    <label className="mt-3 block text-xs">
                      Private one-use link
                      <input
                        className={field + ' mt-1'}
                        readOnly
                        value={portalLink}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    className="mt-3 text-xs underline"
                    onClick={async () => {
                      try {
                        const r = await fetch(
                          `${prefix}/portal?locationId=${encodeURIComponent(locationId)}`,
                        )
                        const result = await r.json()
                        if (!r.ok) throw new Error(result.error)
                        setGrants(result.grants)
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    Review access links
                  </button>
                  <ul className="mt-2 space-y-2">
                    {grants.map((g) => (
                      <li key={g.id} className="text-xs">
                        {g.revoked
                          ? 'Revoked'
                          : g.consumed
                            ? 'Opened'
                            : 'Unused'}{' '}
                        · expires {new Date(g.expiresAt).toLocaleDateString()}
                        {!g.revoked && (
                          <button
                            type="button"
                            disabled={busy}
                            className="ml-2 underline"
                            onClick={() => void portalAccess(g.id)}
                          >
                            Revoke access
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="workspace-panel space-y-3">
                <h3>Ticket controls</h3>
                <label className="block text-xs font-semibold">
                  Stage
                  <select
                    aria-label="Ticket stage"
                    disabled={busy}
                    className={field + ' mt-1'}
                    value={data.ticket.stageId}
                    onChange={(e) => {
                      const stage = data.stages.find(
                        (s) => s.id === e.target.value,
                      )!
                      void mutate(
                        '',
                        {
                          stageId: stage.id,
                          status:
                            stage.name.toLowerCase() === 'resolved'
                              ? 'won'
                              : stage.name.toLowerCase() === 'closed'
                                ? 'lost'
                                : 'open',
                        },
                        'PATCH',
                        'Stage updated',
                      )
                    }}
                  >
                    {data.stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold">
                  Assigned to
                  <select
                    aria-label="Ticket assignee"
                    disabled={busy}
                    className={field + ' mt-1'}
                    value={data.ticket.assignedUserId || ''}
                    onChange={(e) =>
                      void mutate(
                        '',
                        { assignedTo: e.target.value || null },
                        'PATCH',
                        'Assignment updated',
                      )
                    }
                  >
                    <option value="">Unassigned</option>
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold">
                  Priority
                  <select
                    aria-label="Ticket priority"
                    disabled={busy}
                    className={field + ' mt-1'}
                    value={data.ticket.priority || ''}
                    onChange={(e) =>
                      void mutate(
                        '',
                        { priority: e.target.value },
                        'PATCH',
                        'Priority updated',
                      )
                    }
                  >
                    <option value="" disabled>
                      Not set
                    </option>
                    {['Low', 'Normal', 'High', 'Urgent'].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </section>
              <section className="workspace-panel">
                <h3>Response and SLA</h3>
                <p
                  className={
                    'mt-2 text-sm font-semibold ' +
                    (sla?.breached ? 'text-red-700' : 'text-ink/70')
                  }
                >
                  {sla?.label}
                </p>
                {data.details.firstResponseAt ? (
                  <p className="mt-2 text-xs">
                    First response confirmed{' '}
                    {new Date(data.details.firstResponseAt).toLocaleString()}
                  </p>
                ) : (
                  <>
                    <p className="my-3 text-xs text-ink/60">
                      After responding to the customer through your usual
                      channel, confirm it here. This records the current time
                      and sends no message.
                    </p>
                    <button
                      type="button"
                      className={action}
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          '/workspace',
                          { action: 'first-response' },
                          'POST',
                          'First response recorded',
                        )
                      }
                    >
                      Confirm response sent
                    </button>
                  </>
                )}
              </section>
              <section className="workspace-panel">
                <h3>Due date</h3>
                <form
                  key={data.details.dueAt || 'unset'}
                  className="mt-3 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const value = String(
                      new FormData(e.currentTarget).get('dueAt') || '',
                    )
                    void mutate(
                      '/workspace',
                      {
                        action: 'due-date',
                        dueAt: value ? new Date(value).toISOString() : null,
                      },
                      'POST',
                      'Due date saved',
                    )
                  }}
                >
                  <label className="sr-only" htmlFor="ticket-due">
                    Ticket due date
                  </label>
                  <input
                    id="ticket-due"
                    name="dueAt"
                    type="datetime-local"
                    className={field}
                    defaultValue={
                      data.details.dueAt ? localDate(data.details.dueAt) : ''
                    }
                  />
                  <button className={action} disabled={busy}>
                    Save due date
                  </button>
                </form>
              </section>
            </aside>
          </div>
        )}
      </div>
    </dialog>
  )
}
function localDate(value: string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
