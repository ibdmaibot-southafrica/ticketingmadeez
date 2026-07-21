import { ghlJson } from './ghl'

export type Opportunity = {
  id: string
  name: string
  contactId?: string
  pipelineId: string
  pipelineStageId: string
  status?: string
  monetaryValue?: number
  assignedTo?: string
  createdAt: string
  updatedAt: string
  customFields?: Array<{ id: string; value?: unknown; fieldValue?: unknown }>
  contact?: { name?: string; firstName?: string; lastName?: string; email?: string }
}

type OpportunitiesResponse = { opportunities?: Opportunity[]; meta?: { nextPageUrl?: string; total?: number } }

export async function listOpportunities(locationId: string, pipelineId: string): Promise<Opportunity[]> {
  const opportunities: Opportunity[] = []
  let cursor = 1
  const perPage = 100
  for (let page = 0; page < 20; page++) {
    const url = `/opportunities/search?location_id=${encodeURIComponent(locationId)}&pipeline_id=${encodeURIComponent(pipelineId)}&limit=${perPage}&page=${cursor}`
    const res = await ghlJson<OpportunitiesResponse>(url, { locationId, method: 'GET' }).catch(() => null)
    const batch = res?.opportunities ?? []
    opportunities.push(...batch)
    if (batch.length < perPage) break
    cursor += 1
  }
  return opportunities
}

export type PipelineDetail = {
  id: string
  name: string
  stages: Array<{ id: string; name: string; position: number }>
}

export async function getPipeline(locationId: string, pipelineId: string): Promise<PipelineDetail | null> {
  const res = await ghlJson<{ pipelines?: PipelineDetail[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { locationId, method: 'GET' },
  ).catch(() => null)
  return res?.pipelines?.find((p) => p.id === pipelineId) ?? null
}

export async function listPipelines(locationId: string): Promise<PipelineDetail[]> {
  const res = await ghlJson<{ pipelines?: PipelineDetail[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { locationId, method: 'GET' },
  ).catch(() => null)
  return res?.pipelines ?? []
}

export type Ticket = {
  id: string
  subject: string
  contactName?: string
  stageId: string
  stageName?: string
  priority?: string
  source?: string
  description?: string
  createdAt: Date
  updatedAt: Date
  firstResponseAt?: Date
  resolvedAt?: Date
}

export function mapOpportunityToTicket(
  o: Opportunity,
  stages: Array<{ id: string; name: string }>,
  fieldIds: { priority?: string; source?: string; description?: string } | undefined,
): Ticket {
  const stage = stages.find((s) => s.id === o.pipelineStageId)
  const getField = (id?: string): string | undefined => {
    if (!id) return undefined
    const cf = o.customFields?.find((f) => f.id === id)
    const v = cf?.fieldValue ?? cf?.value
    return typeof v === 'string' ? v : undefined
  }
  return {
    id: o.id,
    subject: o.name,
    contactName: o.contact?.name || [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || undefined,
    stageId: o.pipelineStageId,
    stageName: stage?.name,
    priority: getField(fieldIds?.priority),
    source: getField(fieldIds?.source),
    description: getField(fieldIds?.description),
    createdAt: new Date(o.createdAt),
    updatedAt: new Date(o.updatedAt),
  }
}
