import { getFeaturePlan } from '@/lib/entitlements'
import { getInstall, isPaidTier } from '@/lib/kv'
import { ensureDefaultDepartments } from '@/lib/departments'
import { getTicketDetails } from '@/lib/workspace-store'
import {
  getPipeline,
  listOpportunities,
  mapOpportunityToTicket,
} from '@/lib/ghl-data'
import { usersById } from '@/lib/users'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'
import { KanbanBoard } from './KanbanBoard'

export const dynamic = 'force-dynamic'

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string; department?: string }>
}) {
  const { locationId, department } = await searchParams
  if (!locationId) return <NoLocation />
  const install = await getInstall(locationId)
  if (!install) return <NoInstall locationId={locationId} />
  if (!install.pipelineId) {
    return (
      <div>
        <Header title="Tickets" plan={getFeaturePlan(install)} />
        <div className="p-8 text-sm text-ink/60">
          Support Tickets pipeline is not provisioned yet. Reinstall the app to
          fix this.
        </div>
      </div>
    )
  }

  const departments = ensureDefaultDepartments(install)
  const available = isPaidTier(getFeaturePlan(install))
    ? departments
    : departments.slice(0, 1)
  const selected = available.find((d) => d.id === department) ?? available[0]
  const pipelineId = selected?.pipelineId ?? install.pipelineId
  const pipeline = await getPipeline(locationId, pipelineId)
  if (!pipeline) {
    return (
      <div>
        <Header title="Tickets" plan={getFeaturePlan(install)} />
        <div className="p-8 text-sm text-ink/60">
          Pipeline {install.pipelineId} was not found in this account.
        </div>
      </div>
    )
  }

  const [opps, userNames] = await Promise.all([
    listOpportunities(locationId, pipelineId),
    usersById(locationId),
  ])
  const stages = pipeline.stages
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name }))
  const details = await getTicketDetails(
    locationId,
    opps.map((o) => o.id),
  )
  const tickets = opps.map((o) => {
    const t = mapOpportunityToTicket(
      o,
      stages,
      install.customFieldIds,
      userNames,
    )
    const d = details.get(o.id)
    return {
      ...t,
      dueAt: d?.dueAt,
      firstResponseAt: d?.firstResponseAt
        ? new Date(d.firstResponseAt)
        : undefined,
      resolvedAt: d?.resolvedAt ? new Date(d.resolvedAt) : undefined,
    }
  })

  return (
    <div>
      <Header
        title="Tickets"
        subtitle={`${tickets.length} total · pipeline ${pipeline.name}`}
        plan={getFeaturePlan(install)}
      />
      <KanbanBoard
        locationId={locationId}
        stages={stages}
        initialTickets={tickets}
        departments={available.map((d) => ({ id: d.id, name: d.name }))}
        departmentId={selected?.id}
        sla={isPaidTier(getFeaturePlan(install)) ? selected?.sla : undefined}
      />
    </div>
  )
}
