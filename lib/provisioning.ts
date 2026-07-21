import { ghlJson } from './ghl'
import { getInstall, updateInstall } from './kv'

const TICKET_STAGES = ['New', 'In Progress', 'Resolved', 'Closed'] as const
const DEFAULT_PIPELINE_NAME = 'Support Tickets'

type FieldKey = 'priority' | 'source' | 'description'
const CUSTOM_FIELDS: Array<{ key: FieldKey; name: string; dataType: string; options?: string[] }> = [
  {
    key: 'priority',
    name: 'Ticket Priority',
    dataType: 'SINGLE_OPTIONS',
    options: ['Low', 'Normal', 'High', 'Urgent'],
  },
  {
    key: 'source',
    name: 'Ticket Source',
    dataType: 'SINGLE_OPTIONS',
    options: ['Email', 'Form', 'Manual'],
  },
  {
    key: 'description',
    name: 'Ticket Description',
    dataType: 'LARGE_TEXT',
  },
]

type CreatedPipeline = { pipeline: { id: string; name: string; stages: Array<{ id: string; name: string }> } }
type PipelinesList = { pipelines?: Array<{ id: string; name: string }> }
type CreatedField = { customField: { id: string; name: string } }
type FieldsList = { customFields?: Array<{ id: string; name: string; model?: string }> }

async function findOrCreatePipeline(locationId: string, name: string): Promise<string> {
  const existing = await ghlJson<PipelinesList>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { locationId, method: 'GET' },
  ).catch(() => ({ pipelines: [] as PipelinesList['pipelines'] }))
  const found = existing.pipelines?.find((p) => p.name === name)
  if (found) return found.id

  const created = await ghlJson<CreatedPipeline>('/opportunities/pipelines', {
    locationId,
    method: 'POST',
    body: JSON.stringify({
      locationId,
      name,
      stages: TICKET_STAGES.map((s, i) => ({ name: s, position: i })),
    }),
  })
  return created.pipeline.id
}

async function findOrCreateField(
  locationId: string,
  field: { name: string; dataType: string; options?: string[] },
): Promise<string> {
  const existing = await ghlJson<FieldsList>(
    `/locations/${locationId}/customFields`,
    { locationId, method: 'GET' },
  ).catch(() => ({ customFields: [] as FieldsList['customFields'] }))
  const found = existing.customFields?.find((f) => f.name === field.name)
  if (found) return found.id

  const payload: Record<string, unknown> = {
    name: field.name,
    dataType: field.dataType,
    model: 'opportunity',
  }
  if (field.options && field.options.length > 0) {
    payload.options = field.options
  }
  const created = await ghlJson<CreatedField>(`/locations/${locationId}/customFields`, {
    locationId,
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return created.customField.id
}

export async function provisionLocation(locationId: string, opts?: { pipelineName?: string }): Promise<{ pipelineId: string; customFieldIds: Record<string, string> }> {
  const install = await getInstall(locationId)
  if (!install) throw new Error(`No install for ${locationId}`)

  const pipelineName = opts?.pipelineName ?? DEFAULT_PIPELINE_NAME
  const pipelineId = await findOrCreatePipeline(locationId, pipelineName)

  const customFieldIds: Record<string, string> = {}
  for (const field of CUSTOM_FIELDS) {
    customFieldIds[field.key] = await findOrCreateField(locationId, field)
  }

  await updateInstall(locationId, {
    pipelineId,
    customFieldIds: {
      priority: customFieldIds.priority,
      source: customFieldIds.source,
      description: customFieldIds.description,
    },
  })

  return { pipelineId, customFieldIds }
}

export async function deprovisionLocation(_locationId: string): Promise<void> {
  // Intentional no-op on uninstall: leave user data intact so they can reinstall without losing tickets.
  // Cleanup is a settings-page action, not an automatic uninstall side effect.
}
