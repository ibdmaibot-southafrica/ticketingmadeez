import { getInstall } from '@/lib/kv'
import { getPipeline, listOpportunities, mapOpportunityToTicket, type Ticket } from '@/lib/ghl-data'
import { usersById } from '@/lib/users'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'

export const dynamic = 'force-dynamic'

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const install = await getInstall(locationId)
  if (!install) return <NoInstall locationId={locationId} />
  if (!install.pipelineId) {
    return (
      <div>
        <Header title="Tickets" plan={install.plan} />
        <div className="p-8 text-sm text-ink/60">Support Tickets pipeline is not provisioned yet. Reinstall the app to fix this.</div>
      </div>
    )
  }

  const pipeline = await getPipeline(locationId, install.pipelineId)
  if (!pipeline) {
    return (
      <div>
        <Header title="Tickets" plan={install.plan} />
        <div className="p-8 text-sm text-ink/60">Pipeline {install.pipelineId} was not found in this sub-account.</div>
      </div>
    )
  }

  const [opps, userNames] = await Promise.all([
    listOpportunities(locationId, install.pipelineId),
    usersById(locationId),
  ])
  const stages = pipeline.stages.slice().sort((a, b) => a.position - b.position)
  const tickets = opps.map((o) => mapOpportunityToTicket(o, stages, install.customFieldIds, userNames))
  const byStage = new Map<string, Ticket[]>()
  for (const stage of stages) byStage.set(stage.id, [])
  for (const t of tickets) {
    const list = byStage.get(t.stageId)
    if (list) list.push(t)
  }

  return (
    <div>
      <Header
        title="Tickets"
        subtitle={`${tickets.length} total · pipeline ${pipeline.name}`}
        plan={install.plan}
      />
      <div className="p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
          {stages.map((stage) => {
            const list = byStage.get(stage.id) ?? []
            return (
              <div key={stage.id} className="min-w-0">
                <div className="flex items-center justify-between px-1 mb-2">
                  <h2 className="text-sm font-heading font-bold uppercase tracking-wider text-ink/70">{stage.name}</h2>
                  <span className="text-xs text-ink/40">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-ink/10 p-4 text-xs text-ink/40 text-center">No tickets</div>
                  ) : (
                    list.map((t) => <TicketCard key={t.id} t={t} />)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TicketCard({ t }: { t: Ticket }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3 shadow-sm">
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

function formatWhen(d: Date): string {
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}
