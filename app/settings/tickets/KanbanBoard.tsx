'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Ticket } from '@/lib/ghl-data'

type Stage = { id: string; name: string }

export function KanbanBoard({
  locationId,
  stages,
  initialTickets,
}: {
  locationId: string
  stages: Stage[]
  initialTickets: Ticket[]
}) {
  const router = useRouter()
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [pending, startTransition] = useTransition()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverStageId, setHoverStageId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())

  const byStage = new Map<string, Ticket[]>()
  for (const s of stages) byStage.set(s.id, [])
  for (const t of tickets) byStage.get(t.stageId)?.push(t)

  async function moveTo(ticketId: string, toStageId: string) {
    const t = tickets.find((x) => x.id === ticketId)
    if (!t || t.stageId === toStageId) return
    const fromStageId = t.stageId
    // Optimistic
    setTickets((cur) => cur.map((x) => (x.id === ticketId ? { ...x, stageId: toStageId, stageName: stages.find((s) => s.id === toStageId)?.name } : x)))
    setSavingIds((cur) => new Set(cur).add(ticketId))
    setErr(null)
    try {
      const status = (() => {
        const name = stages.find((s) => s.id === toStageId)?.name?.toLowerCase() ?? ''
        if (name === 'resolved') return 'won'
        if (name === 'closed') return 'lost'
        return 'open'
      })()
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, stageId: toStageId, status }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || res.statusText)
      }
      startTransition(() => router.refresh())
    } catch (e) {
      // Revert
      setTickets((cur) => cur.map((x) => (x.id === ticketId ? { ...x, stageId: fromStageId, stageName: stages.find((s) => s.id === fromStageId)?.name } : x)))
      setErr(`Move failed: ${(e as Error).message}`)
    } finally {
      setSavingIds((cur) => {
        const n = new Set(cur)
        n.delete(ticketId)
        return n
      })
    }
  }

  return (
    <div className="p-6">
      {err ? <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">{err}</div> : null}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((stage) => {
          const list = byStage.get(stage.id) ?? []
          const isHover = hoverStageId === stage.id && draggingId
          return (
            <div
              key={stage.id}
              className="min-w-0"
              onDragOver={(e) => {
                if (!draggingId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (hoverStageId !== stage.id) setHoverStageId(stage.id)
              }}
              onDragLeave={() => {
                if (hoverStageId === stage.id) setHoverStageId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/ticket-id') || draggingId
                setHoverStageId(null)
                setDraggingId(null)
                if (id) moveTo(id, stage.id)
              }}
            >
              <div className="flex items-center justify-between px-1 mb-2">
                <h2 className="text-sm font-heading font-bold uppercase tracking-wider text-ink/70">{stage.name}</h2>
                <span className="text-xs text-ink/40">{list.length}</span>
              </div>
              <div
                className={
                  'space-y-2 rounded-lg p-1 transition-colors ' +
                  (isHover ? 'bg-cyan/10 ring-2 ring-cyan/40 ring-inset' : '')
                }
                style={{ minHeight: 80 }}
              >
                {list.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-ink/10 p-4 text-xs text-ink/40 text-center">Drop here</div>
                ) : (
                  list.map((t) => (
                    <TicketCard
                      key={t.id}
                      t={t}
                      saving={savingIds.has(t.id)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/ticket-id', t.id)
                        setDraggingId(t.id)
                      }}
                      onDragEnd={() => {
                        setDraggingId(null)
                        setHoverStageId(null)
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TicketCard({
  t,
  saving,
  onDragStart,
  onDragEnd,
}: {
  t: Ticket
  saving: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={
        'rounded-xl border border-ink/10 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing select-none transition-opacity ' +
        (saving ? 'opacity-60' : 'hover:shadow-md')
      }
    >
      <div className="flex items-start gap-2">
        <div className="h-6 w-6 rounded-full bg-cyan/15 text-cyan text-[11px] font-bold flex items-center justify-center shrink-0">
          {(t.contactName ?? t.subject).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink truncate">{t.subject || 'Untitled ticket'}</div>
          {t.contactName ? <div className="text-[11px] text-ink/50 truncate">{t.contactName}</div> : null}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {t.priority ? <PriorityChip value={t.priority} /> : null}
        {t.source ? <span className="text-[10px] text-ink/50">{t.source}</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ink/40">
        <span>{formatWhen(t.updatedAt)}</span>
        {t.assignedUserName ? (
          <span className="inline-flex items-center gap-1 text-ink/70">
            <span className="h-4 w-4 rounded-full bg-emerald/20 text-emerald text-[9px] font-bold flex items-center justify-center">
              {t.assignedUserName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate max-w-[110px]">{t.assignedUserName}</span>
          </span>
        ) : (
          <span className="italic text-ink/40">Unassigned</span>
        )}
      </div>
    </div>
  )
}

function PriorityChip({ value }: { value: string }) {
  const v = value.toLowerCase()
  const cls =
    v === 'urgent'
      ? 'bg-red-100 text-red-700'
      : v === 'high'
      ? 'bg-orange-100 text-orange-700'
      : v === 'low'
      ? 'bg-slate-100 text-slate-600'
      : 'bg-cyan/15 text-cyan'
  return <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>{value}</span>
}

function formatWhen(d: Date | string): string {
  const t = typeof d === 'string' ? new Date(d) : d
  const diffMin = Math.floor((Date.now() - t.getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return t.toLocaleDateString()
}
