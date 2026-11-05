'use client'
import { accountFetch } from '@/lib/account-fetch'
import { useEffect, useState } from 'react'
import { AiControls, type AiControlData } from './AiControls'
import type {
  Article,
  Project,
  Task,
  HubItem,
  TimeEntry,
} from '@/lib/hub-store'
type Workspace = {
  projects: HubItem<Project>[]
  tasks: HubItem<Task>[]
  articles: HubItem<Article>[]
  time: TimeEntry[]
  users: { id: string; name: string }[]
  userId: string
  admin: boolean
  ai?: AiControlData
}
const field =
  'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm'
const button =
  'rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
export function HubClient({
  locationId,
  mode,
}: {
  locationId: string
  mode: 'knowledge' | 'projects'
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('')
  const [editingArticle, setEditingArticle] = useState<HubItem<Article> | null>(
    null,
  )
  const [aiQuestion, setAiQuestion] = useState(''),
    [aiConsent, setAiConsent] = useState(false),
    [aiDraft, setAiDraft] = useState(''),
    [aiSources, setAiSources] = useState<{ id: string; title: string }[]>([])
  useEffect(() => {
    const controller = new AbortController()
    accountFetch(`/api/workspace?locationId=${encodeURIComponent(locationId)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error)
        return body
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => controller.abort()
  }, [locationId, revision])
  useEffect(() => setAiConsent(false), [data?.ai?.settings.provider])
  async function save(action: string, value: unknown, id?: string) {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      const r = await accountFetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, action, data: value, id }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setRevision((v) => v + 1)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  if (!data)
    return (
      <div className="p-6">
        <p role={error ? 'alert' : 'status'}>
          {error || 'Loading workspace...'}
        </p>
        {error && (
          <button
            className={button}
            onClick={() => {
              setError('')
              setRevision((n) => n + 1)
            }}
          >
            Retry
          </button>
        )}
      </div>
    )
  const running = data.time.find((t) => !t.endedAt && t.userId === data.userId)
  const totals = new Map<string, number>()
  let unpriced = 0
  for (const t of data.time) {
    if (t.billable && t.minutes !== null) {
      if (t.rateMinor !== null && t.currency)
        totals.set(
          t.currency,
          (totals.get(t.currency) || 0) +
            Math.round((t.minutes * t.rateMinor) / 60),
        )
      else unpriced++
    }
  }
  return (
    <div className="space-y-6 p-6">
      <p className="text-xs text-ink/50">This workspace lists up to 500 projects, tasks and knowledge articles, and the latest 1,000 time entries. Billing totals cover only the listed entries.</p>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {mode === 'knowledge' ? (
        <>
          {data.admin && data.ai && (
            <AiControls
              key={JSON.stringify(data.ai.settings)}
              data={data.ai}
              busy={busy}
              save={(value) => save('ai-settings', value)}
              locationId={locationId}
              onConnectionChange={()=>setRevision(v=>v+1)}
            />
          )}
          {data.admin && (
            <section className="workspace-panel">
              <h2>AI answer draft</h2>
              <p className="mt-1 text-xs text-ink/60">
                Uses matching published articles from this account and your own
                connected AI account. AI usage is excluded from the app trial and
                subscription. Drafts need your review and are never sent automatically.
              </p>
              <form
                className="mt-3 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (busy) return
                  setBusy(true)
                  setError('')
                  setAiDraft('')
                  try {
                    const r = await accountFetch('/api/workspace/assist', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        locationId,
                        question: aiQuestion,
                        consent: aiConsent,
                      }),
                    })
                    const result = await r.json()
                    if (!r.ok) throw new Error(result.error)
                    setAiDraft(result.draft)
                    setAiSources(result.sources)
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <label className="block text-xs">
                  Question
                  <textarea
                    required
                    minLength={3}
                    maxLength={1500}
                    value={aiQuestion}
                    onChange={(e) => setAiQuestion(e.target.value)}
                    className={field}
                    rows={3}
                  />
                </label>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    required
                    checked={aiConsent}
                    onChange={(e) => setAiConsent(e.target.checked)}
                  />
                  Send this question and matching published help articles to{' '}
                  {data.ai?.providers.find(
                    (p) => p.provider === data.ai?.settings.provider,
                  )?.name || 'the selected AI provider'}{' '}
                  to draft an answer using my own API account. I am responsible
                  for the provider's AI charges. No AI usage is included in the
                  app trial or subscription.
                </label>
                <button
                  className={button}
                  disabled={busy || !aiConsent || !data.ai?.settings.enabled}
                >
                  Generate draft
                </button>
              </form>
              {aiDraft && (
                <div className="mt-4 rounded-lg border border-cyan/30 bg-cyan/5 p-4">
                  <p className="text-xs font-semibold">Draft for review</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{aiDraft}</p>
                  <p className="mt-3 text-xs text-ink/50">
                    Articles consulted:{' '}
                    {aiSources.map((s) => s.title).join(', ') || 'None'}
                  </p>
                </div>
              )}
            </section>
          )}
          <label className="block max-w-xl text-sm">
            Search knowledge articles
            <input
              className={field + ' mt-2'}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles and article text"
            />
          </label>
          {data.admin && (
            <section className="workspace-panel">
              <h2>{editingArticle ? 'Edit article' : 'New article'}</h2>
              <p className="mt-1 text-xs text-ink/60">
                Drafts stay internal. Published articles are available to
                customers with an active support portal link.
              </p>
              <form
                key={editingArticle?.id || 'new'}
                className="mt-4 grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = e.currentTarget
                  const values = new FormData(form)
                  if (
                    await save(
                      'article',
                      {
                        title: values.get('title'),
                        body: values.get('body'),
                        published: values.get('published') === 'on',
                      },
                      editingArticle?.id,
                    )
                  ) {
                    form.reset()
                    setEditingArticle(null)
                  }
                }}
              >
                <label className="text-xs">
                  Title
                  <input
                    name="title"
                    required
                    maxLength={160}
                    defaultValue={editingArticle?.data.title}
                    className={field}
                  />
                </label>
                <label className="text-xs">
                  Article
                  <textarea
                    name="body"
                    required
                    maxLength={50000}
                    rows={6}
                    defaultValue={editingArticle?.data.body}
                    className={field}
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    name="published"
                    type="checkbox"
                    defaultChecked={editingArticle?.data.published}
                  />
                  Publish to the support portal
                </label>
                <div className="flex gap-2">
                  <button className={button} disabled={busy}>
                    Save article
                  </button>
                  {editingArticle && (
                    <button
                      type="button"
                      onClick={() => setEditingArticle(null)}
                      className="px-3 text-sm"
                    >
                      Cancel editing
                    </button>
                  )}
                </div>
              </form>
            </section>
          )}
          <div className="space-y-3">
            {data.articles
              .filter((a) =>
                (a.data.title + ' ' + a.data.body)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((a) => (
                <article key={a.id} className="workspace-panel">
                  <div className="flex justify-between gap-3">
                    <h2>{a.data.title}</h2>
                    <span className="text-xs text-ink/50">
                      {a.data.published ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-ink/70">
                    {a.data.body}
                  </p>
                  {data.admin && (
                    <button
                      className="mt-3 text-sm underline"
                      onClick={() => setEditingArticle(a)}
                    >
                      Edit article
                    </button>
                  )}
                </article>
              ))}
          </div>
          {!data.articles.length && (
            <p className="text-sm text-ink/60">
              Create your first article to give the team a shared answer.
            </p>
          )}
        </>
      ) : (
        <>
          <section className="workspace-panel">
            <h2>Projects</h2>
            {data.admin && (
              <form
                className="mt-4 grid gap-3 md:grid-cols-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = e.currentTarget,
                    v = new FormData(form)
                  const rate = String(v.get('hourlyRate') || '')
                  if (
                    await save('project', {
                      title: v.get('title'),
                      description: v.get('description'),
                      status: 'planned',
                      ...(rate
                        ? {
                            hourlyRate: Number(rate),
                            currency: String(v.get('currency')).toUpperCase(),
                          }
                        : {}),
                    })
                  )
                    form.reset()
                }}
              >
                <label className="text-xs">
                  Project name
                  <input
                    name="title"
                    className={field}
                    required
                    maxLength={160}
                  />
                </label>
                <label className="text-xs">
                  Description
                  <input
                    name="description"
                    className={field}
                    maxLength={10000}
                  />
                </label>
                <label className="text-xs">
                  Hourly rate, optional
                  <input
                    name="hourlyRate"
                    className={field}
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.01"
                    placeholder="Enter an agreed rate"
                  />
                </label>
                <label className="text-xs">
                  Currency code, required with a rate
                  <input
                    name="currency"
                    className={field}
                    minLength={3}
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    placeholder="For example, ZAR"
                  />
                </label>
                <button className={button} disabled={busy}>
                  Create project
                </button>
              </form>
            )}
            <ul className="mt-5 divide-y divide-ink/10">
              {data.projects.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <h3>{p.data.title}</h3>
                    <p className="text-xs text-ink/50">{p.data.description}</p>
                    {data.admin && p.data.hourlyRate !== undefined && (
                      <p className="mt-1 text-xs">
                        {p.data.currency} {p.data.hourlyRate.toFixed(2)} per
                        hour
                      </p>
                    )}
                  </div>
                  {data.admin ? (
                    <label className="text-xs">
                      Project status
                      <select
                        aria-label={`Status for ${p.data.title}`}
                        value={p.data.status}
                        className={field}
                        disabled={busy}
                        onChange={(e) =>
                          void save(
                            'project',
                            { ...p.data, status: e.target.value },
                            p.id,
                          )
                        }
                      >
                        {['planned', 'active', 'completed'].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="text-xs">{p.data.status}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {data.admin && data.projects.length > 0 && (
            <section className="workspace-panel">
              <h2>Team allocation and staff rates</h2>
              <p className="mt-1 text-xs text-ink/60">
                Assign several team members to a project. Staff rates override
                the project rate for new time entries and are visible to
                administrators only.
              </p>
              {data.projects.map((p) => (
                <div key={p.id} className="mt-5 border-t border-ink/10 pt-4">
                  <h3>{p.data.title}</h3>
                  <form
                    className="mt-3 flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const v = new FormData(e.currentTarget)
                      void save(
                        'project',
                        {
                          ...p.data,
                          members: v.getAll('members'),
                          visibility: v.get('visibility'),
                        },
                        p.id,
                      )
                    }}
                  >
                    <label className="text-xs">
                      Project team
                      <select
                        name="members"
                        multiple
                        defaultValue={p.data.members ?? []}
                        className={field}
                      >
                        {data.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      Project visibility
                      <select
                        name="visibility"
                        defaultValue={p.data.visibility || 'account'}
                        className={field}
                      >
                        <option value="account">Account team</option>
                        <option value="members">
                          Assigned team and administrators
                        </option>
                      </select>
                    </label>
                    <button className={button} disabled={busy}>
                      Save team
                    </button>
                  </form>
                  <form
                    className="mt-3 grid gap-3 md:grid-cols-4"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const form = e.currentTarget,
                        v = new FormData(form),
                        userId = String(v.get('userId'))
                      if (
                        await save(
                          'project',
                          {
                            ...p.data,
                            userRates: [
                              ...(p.data.userRates ?? []).filter(
                                (r) => r.userId !== userId,
                              ),
                              {
                                userId,
                                hourlyRate: Number(v.get('rate')),
                                currency: String(
                                  v.get('currency'),
                                ).toUpperCase(),
                              },
                            ],
                          },
                          p.id,
                        )
                      )
                        form.reset()
                    }}
                  >
                    <label className="text-xs">
                      Team member
                      <select required name="userId" className={field}>
                        <option value="">Choose a person</option>
                        {data.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      Agreed hourly rate
                      <input
                        required
                        name="rate"
                        type="number"
                        min={0}
                        max={1000000}
                        step="0.01"
                        className={field}
                      />
                    </label>
                    <label className="text-xs">
                      Currency code
                      <input
                        required
                        name="currency"
                        minLength={3}
                        maxLength={3}
                        pattern="[A-Za-z]{3}"
                        className={field}
                      />
                    </label>
                    <button className={button} disabled={busy}>
                      Save staff rate
                    </button>
                  </form>
                  <ul className="mt-3 space-y-1 text-xs">
                    {p.data.userRates?.map((r) => (
                      <li key={r.userId}>
                        {data.users.find((u) => u.id === r.userId)?.name ||
                          'Team member'}
                        : {r.currency} {r.hourlyRate.toFixed(2)} per hour
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          <section className="workspace-panel">
            <h2>Tasks</h2>
            <form
              className="mt-4 grid gap-3 md:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const form = e.currentTarget,
                  v = new FormData(form),
                  date = String(v.get('dueAt') || ''),
                  ticketId = String(v.get('ticketId') || '').trim(),
                  assignedTo = String(v.get('assignedTo') || '')
                if (
                  await save('task', {
                    title: v.get('title'),
                    projectId: v.get('projectId'),
                    status: 'todo',
                    dueAt: date ? new Date(date).toISOString() : null,
                    ...(ticketId ? { ticketId } : {}),
                    ...(assignedTo ? { assignedTo } : {}),
                  })
                )
                  form.reset()
              }}
            >
              <label className="text-xs">
                Task
                <input
                  name="title"
                  required
                  maxLength={160}
                  className={field}
                />
              </label>
              <label className="text-xs">
                Project
                <ProjectSelect projects={data.projects} />
              </label>
              <label className="text-xs">
                Assigned to
                <select name="assignedTo" className={field}>
                  <option value="">Unassigned</option>
                  {data.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                Due date
                <input type="datetime-local" name="dueAt" className={field} />
              </label>
              <label className="text-xs">
                Linked support ticket ID, optional
                <input name="ticketId" className={field} />
              </label>
              <button
                className={button}
                disabled={busy || !data.projects.length}
              >
                Add task
              </button>
            </form>
            <ul className="mt-5 divide-y divide-ink/10">
              {data.tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div>
                    <h3>{t.data.title}</h3>
                    <p className="mt-1 text-xs text-ink/60">
                      {
                        data.projects.find((p) => p.id === t.data.projectId)
                          ?.data.title
                      }{' '}
                      ·{' '}
                      {data.users.find((u) => u.id === t.data.assignedTo)
                        ?.name || 'Unassigned'}
                      {t.data.dueAt
                        ? ` · Due ${new Date(t.data.dueAt).toLocaleString()}`
                        : ''}
                    </p>
                    {t.data.ticketId && (
                      <p className="text-xs text-ink/50">
                        Ticket {t.data.ticketId}
                      </p>
                    )}
                  </div>
                  <label className="text-xs">
                    Task status
                    <select
                      aria-label={`Status for ${t.data.title}`}
                      value={t.data.status}
                      disabled={busy}
                      className={field}
                      onChange={(e) =>
                        void save(
                          'task',
                          { ...t.data, status: e.target.value },
                          t.id,
                        )
                      }
                    >
                      {['todo', 'doing', 'done'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </section>
          <section className="workspace-panel">
            <h2>Time tracking</h2>
            <p className="mt-1 text-xs text-ink/60">
              Timers use server time and round up to a whole minute when
              stopped. One timer can run per team member.
            </p>
            {running ? (
              <div className="mt-4 flex items-center gap-4">
                <p className="text-sm">
                  Running since {new Date(running.startedAt).toLocaleString()}:{' '}
                  {running.description}
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void save('timer-stop', {})}
                >
                  Stop my timer
                </button>
              </div>
            ) : (
              <form
                className="mt-4 grid gap-3 md:grid-cols-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const form = e.currentTarget,
                    v = new FormData(form),
                    minutes = String(v.get('minutes') || '')
                  if (
                    await save(minutes ? 'manual-time' : 'timer-start', {
                      projectId: v.get('projectId'),
                      description: v.get('description'),
                      billable: v.get('billable') === 'on',
                      ...(minutes ? { minutes: Number(minutes) } : {}),
                    })
                  )
                    form.reset()
                }}
              >
                <label className="text-xs">
                  Project
                  <ProjectSelect projects={data.projects} />
                </label>
                <label className="text-xs">
                  What are you working on?
                  <input
                    name="description"
                    className={field}
                    required
                    maxLength={1000}
                  />
                </label>
                <label className="text-xs">
                  Manual minutes, leave empty to start a timer
                  <input
                    name="minutes"
                    type="number"
                    min={1}
                    max={1440}
                    className={field}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input name="billable" type="checkbox" />
                  Billable work
                </label>
                <button
                  className={button}
                  disabled={busy || !data.projects.length}
                >
                  Start timer or save manual time
                </button>
              </form>
            )}
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-ink/50">
                    <th className="py-2">Work</th>
                    <th>Team member</th>
                    <th>Minutes</th>
                    <th>Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {data.time.map((t) => (
                    <tr key={t.id} className="border-t border-ink/10">
                      <td className="py-2">
                        {t.description}
                        <p className="text-xs text-ink/50">
                          {
                            data.projects.find((p) => p.id === t.projectId)
                              ?.data.title
                          }
                        </p>
                      </td>
                      <td>
                        {data.users.find((u) => u.id === t.userId)?.name ||
                          'Team member'}
                      </td>
                      <td>{t.minutes ?? 'Running'}</td>
                      <td>{t.billable ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink/50">
              Showing the latest {data.time.length} entries, up to 1,000.
            </p>
          </section>
          {data.admin && (
            <section className="workspace-panel">
              <h2>Billing summary for listed time entries</h2>
              <p className="mt-1 text-xs text-ink/60">
                Amounts use the rate saved when each entry started. This summary
                creates no invoice and takes no payment.
              </p>
              <ul className="mt-4 space-y-2">
                {Array.from(totals).map(([currency, minor]) => (
                  <li key={currency} className="text-lg font-semibold">
                    {currency} {(minor / 100).toFixed(2)}
                  </li>
                ))}
              </ul>
              {!totals.size && (
                <p className="mt-3 text-sm">No priced billable entries yet.</p>
              )}
              {unpriced > 0 && (
                <p className="mt-3 text-sm">
                  {unpriced} billable entries have no agreed rate and are
                  excluded from the amounts.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
function ProjectSelect({ projects }: { projects: HubItem<Project>[] }) {
  return (
    <select name="projectId" required className={field}>
      <option value="">Choose a project</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.data.title}
        </option>
      ))}
    </select>
  )
}
