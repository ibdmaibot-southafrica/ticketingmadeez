'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, PlanTier } from '@/lib/kv'

type PipelineOption = { id: string; name: string }

export function DepartmentsClient({
  locationId,
  plan,
  departments,
  pipelines,
}: {
  locationId: string
  plan: PlanTier
  departments: Department[]
  pipelines: PipelineOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPipelineId, setNewPipelineId] = useState<string>(pipelines[0]?.id ?? '')
  const [err, setErr] = useState<string | null>(null)

  const isPaid = plan === 'paid'
  const canAdd = isPaid

  async function addDepartment() {
    setErr(null)
    if (!newName.trim()) {
      setErr('Name is required.')
      return
    }
    if (!newPipelineId) {
      setErr('Pick a pipeline.')
      return
    }
    const res = await fetch('/api/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, name: newName.trim(), pipelineId: newPipelineId }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      setErr(`Failed: ${detail || res.statusText}`)
      return
    }
    setNewName('')
    setShowAdd(false)
    startTransition(() => router.refresh())
  }

  async function deleteDepartment(id: string) {
    if (departments.length <= 1) {
      setErr('Cannot delete the last department.')
      return
    }
    if (!confirm('Delete this department? Existing tickets in the pipeline stay.')) return
    const res = await fetch(`/api/departments/${encodeURIComponent(id)}?locationId=${encodeURIComponent(locationId)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      setErr(await res.text().catch(() => 'Failed'))
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-ink/60">{departments.length} department{departments.length === 1 ? '' : 's'}</div>
        <button
          disabled={!canAdd || pending}
          onClick={() => setShowAdd((v) => !v)}
          className={
            'text-sm px-3 py-1.5 rounded-md ' +
            (canAdd
              ? 'bg-cyan text-ink font-semibold hover:brightness-95'
              : 'bg-ink/10 text-ink/40 cursor-not-allowed')
          }
          title={canAdd ? 'Add department' : 'Pro tier only'}
        >
          + Add department {canAdd ? '' : '(Pro)'}
        </button>
      </div>

      {err ? <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div> : null}

      {showAdd && canAdd ? (
        <div className="mb-4 rounded-xl border border-ink/10 bg-white p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-ink/60 mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm"
                placeholder="Billing"
              />
            </div>
            <div>
              <label className="block text-xs text-ink/60 mb-1">Pipeline</label>
              <select
                value={newPipelineId}
                onChange={(e) => setNewPipelineId(e.target.value)}
                className="w-full rounded-md border border-ink/15 px-3 py-2 text-sm bg-white"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={addDepartment}
                disabled={pending}
                className="rounded-md bg-cyan text-ink font-semibold text-sm px-3 py-2 hover:brightness-95 disabled:opacity-50"
              >
                {pending ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-md text-sm text-ink/60 px-3 py-2 hover:bg-ink/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-ink/60 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-semibold">Department</th>
              <th className="text-left px-4 py-3 font-semibold">Pipeline</th>
              <th className="text-left px-4 py-3 font-semibold">SLA</th>
              <th className="text-right px-4 py-3 font-semibold w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => {
              const pipeName = pipelines.find((p) => p.id === d.pipelineId)?.name ?? d.pipelineId
              return (
                <tr key={d.id} className="border-t border-ink/5">
                  <td className="px-4 py-3 font-semibold text-ink">{d.name}</td>
                  <td className="px-4 py-3 text-ink/70">{pipeName}</td>
                  <td className="px-4 py-3 text-ink/70">
                    {d.sla?.active
                      ? `${formatMinutes(d.sla.firstResponseMinutes)} / ${formatMinutes(d.sla.resolutionMinutes)}`
                      : <span className="text-ink/40">off</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={!isPaid || pending || departments.length <= 1}
                      onClick={() => deleteDepartment(d.id)}
                      className={
                        'text-xs px-2 py-1 rounded ' +
                        (isPaid && departments.length > 1
                          ? 'text-red-600 hover:bg-red-50'
                          : 'text-ink/30 cursor-not-allowed')
                      }
                      title={isPaid ? (departments.length > 1 ? 'Delete' : 'Cannot delete the last one') : 'Pro tier only'}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!isPaid ? (
        <p className="mt-4 text-xs text-ink/50">
          The Free tier supports one Support department. Upgrade to Pro from the marketplace listing to add more.
        </p>
      ) : null}
    </div>
  )
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.round((m / 60) * 10) / 10
  if (h < 24) return `${h}h`
  const d = Math.round((h / 24) * 10) / 10
  return `${d}d`
}
