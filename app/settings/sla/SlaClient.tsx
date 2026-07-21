'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Department, PlanTier } from '@/lib/kv'

export function SlaClient({ locationId, plan, departments }: { locationId: string; plan: PlanTier; departments: Department[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rows, setRows] = useState<Department[]>(departments)
  const [err, setErr] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const isPaid = plan === 'paid'

  function updateRow(id: string, patch: Partial<Department['sla']>) {
    setRows((cur) =>
      cur.map((d) =>
        d.id === id
          ? {
              ...d,
              sla: {
                firstResponseMinutes: d.sla?.firstResponseMinutes ?? 60,
                resolutionMinutes: d.sla?.resolutionMinutes ?? 1440,
                active: d.sla?.active ?? true,
                ...patch,
              },
            }
          : d,
      ),
    )
  }

  async function save(id: string) {
    setErr(null)
    setSavedId(null)
    const row = rows.find((r) => r.id === id)
    if (!row || !row.sla) return
    const res = await fetch(`/api/departments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, sla: row.sla }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      setErr(`Save failed: ${detail || res.statusText}`)
      return
    }
    setSavedId(id)
    startTransition(() => router.refresh())
    setTimeout(() => setSavedId((v) => (v === id ? null : v)), 2000)
  }

  return (
    <div>
      {err ? <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div> : null}

      <div className="rounded-xl border border-ink/10 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-ink/60 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-semibold">Department</th>
              <th className="text-left px-4 py-3 font-semibold">First response target</th>
              <th className="text-left px-4 py-3 font-semibold">Resolution target</th>
              <th className="text-left px-4 py-3 font-semibold w-20">Active</th>
              <th className="text-right px-4 py-3 font-semibold w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const sla = d.sla ?? { firstResponseMinutes: 60, resolutionMinutes: 1440, active: false }
              return (
                <tr key={d.id} className="border-t border-ink/5 align-middle">
                  <td className="px-4 py-3 font-semibold text-ink">{d.name}</td>
                  <td className="px-4 py-3">
                    <MinutesInput
                      value={sla.firstResponseMinutes}
                      onChange={(v) => updateRow(d.id, { firstResponseMinutes: v })}
                      disabled={!isPaid}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <MinutesInput
                      value={sla.resolutionMinutes}
                      onChange={(v) => updateRow(d.id, { resolutionMinutes: v })}
                      disabled={!isPaid}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sla.active}
                        onChange={(e) => updateRow(d.id, { active: e.target.checked })}
                        disabled={!isPaid}
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-ink/60">{sla.active ? 'On' : 'Off'}</span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={!isPaid || pending}
                      onClick={() => save(d.id)}
                      className={
                        'text-xs px-3 py-1.5 rounded ' +
                        (isPaid
                          ? 'bg-cyan text-ink font-semibold hover:brightness-95'
                          : 'bg-ink/10 text-ink/40 cursor-not-allowed')
                      }
                    >
                      {savedId === d.id ? 'Saved ✓' : pending ? 'Saving…' : 'Save'}
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
          The Free tier shows one default SLA (1h response, 24h resolution). Upgrade to Pro from the marketplace listing to configure per-department SLAs and turn breach tracking on.
        </p>
      ) : (
        <p className="mt-4 text-xs text-ink/50">
          When an SLA is <b>on</b>, a workflow in the sub-account should trigger on new tickets and check the response/resolution timers. See the Getting Started guide for the workflow template.
        </p>
      )}
    </div>
  )
}

const PRESETS = [
  { label: '15 min', v: 15 },
  { label: '1 hour', v: 60 },
  { label: '2 hours', v: 120 },
  { label: '4 hours', v: 240 },
  { label: '8 hours', v: 480 },
  { label: '1 day', v: 1440 },
  { label: '2 days', v: 2880 },
  { label: '5 days', v: 7200 },
]

function MinutesInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className={
        'rounded-md border px-2 py-1.5 text-sm bg-white ' +
        (disabled ? 'border-ink/10 text-ink/50' : 'border-ink/20')
      }
    >
      {PRESETS.some((p) => p.v === value) ? null : (
        <option value={value}>{value} min</option>
      )}
      {PRESETS.map((p) => (
        <option key={p.v} value={p.v}>
          {p.label}
        </option>
      ))}
    </select>
  )
}
