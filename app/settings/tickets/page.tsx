import { getInstall } from '@/lib/kv'
import { getPipeline, listOpportunities, mapOpportunityToTicket } from '@/lib/ghl-data'
import { usersById } from '@/lib/users'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'
import { KanbanBoard } from './KanbanBoard'

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
  const stages = pipeline.stages.slice().sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, name: s.name }))
  const tickets = opps.map((o) => mapOpportunityToTicket(o, stages, install.customFieldIds, userNames))

  return (
    <div>
      <Header
        title="Tickets"
        subtitle={`${tickets.length} total · pipeline ${pipeline.name}`}
        plan={install.plan}
      />
      <KanbanBoard locationId={locationId} stages={stages} initialTickets={tickets} />
    </div>
  )
}
