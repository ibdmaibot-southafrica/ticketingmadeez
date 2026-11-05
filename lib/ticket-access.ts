import { getInstall } from './kv'
import { ghlJson } from './ghl'
import { ensureDefaultDepartments } from './departments'
import type { Opportunity } from './ghl-data'

export async function ticketAccess(locationId: string, ticketId: string) {
  const install = await getInstall(locationId)
  if (!install) return null
  const result = await ghlJson<{
    opportunity: Opportunity & { locationId: string }
  }>(`/opportunities/${encodeURIComponent(ticketId)}`, {
    locationId,
    method: 'GET',
  })
  const opportunity = result.opportunity
  const departments = ensureDefaultDepartments(install)
  const pipelines = new Set(
    [install.pipelineId, ...departments.map((d) => d.pipelineId)].filter(
      Boolean,
    ),
  )
  if (
    opportunity.locationId !== locationId ||
    !pipelines.has(opportunity.pipelineId)
  )
    return null
  return {
    install,
    opportunity,
    department: departments.find(
      (d) => d.pipelineId === opportunity.pipelineId,
    ),
  }
}
