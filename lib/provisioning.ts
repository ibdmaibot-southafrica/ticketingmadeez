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
type FieldsList = { customFields?: Array<{ id: string; name: string; fieldKey?: string; model?: string }> }

// GHL surfaces a duplicate-name conflict as HTTP 400 with a message like
// "opportunity.ticket_priority already exists" and meta.existingId in the body.
// This helper extracts the existing id so we can reuse it instead of aborting.
function extractExistingIdFromError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/"existingId"\s*:\s*"([^"]+)"/)
  return m?.[1] ?? null
}

async function findOrCreatePipeline(locationId: string, name: string): Promise<string> {
  const existing = await ghlJson<PipelinesList>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { locationId, method: 'GET' },
  ).catch(() => ({ pipelines: [] as PipelinesList['pipelines'] }))
  const found = existing.pipelines?.find((p) => p.name === name)
  if (found) return found.id

  try {
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
  } catch (e) {
    const existingId = extractExistingIdFromError(e)
    if (existingId) return existingId
    throw e
  }
}

async function findOrCreateField(
  locationId: string,
  field: { key: string; name: string; dataType: string; options?: string[] },
): Promise<string> {
  // Query with model=opportunity so GHL scopes the list; without it the API
  // sometimes returns [] for opportunity-model fields even when they exist.
  const existing = await ghlJson<FieldsList>(
    `/locations/${locationId}/customFields?model=opportunity`,
    { locationId, method: 'GET' },
  ).catch(() => ({ customFields: [] as FieldsList['customFields'] }))
  const wantedFieldKey = `opportunity.ticket_${field.key}`
  // Prefer fieldKey match (canonical) over name match (localizable).
  const found =
    existing.customFields?.find((f) => f.fieldKey === wantedFieldKey) ??
    existing.customFields?.find((f) => f.name === field.name && (f.model ?? 'opportunity') === 'opportunity')
  if (found) return found.id

  const payload: Record<string, unknown> = {
    name: field.name,
    dataType: field.dataType,
    model: 'opportunity',
  }
  if (field.options && field.options.length > 0) {
    payload.options = field.options
  }
  try {
    const created = await ghlJson<CreatedField>(`/locations/${locationId}/customFields`, {
      locationId,
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return created.customField.id
  } catch (e) {
    // GHL 400 with an existingId means the field was created by a prior install
    // (or a race with a parallel provision). Reuse the id instead of aborting.
    const existingId = extractExistingIdFromError(e)
    if (existingId) return existingId
    throw e
  }
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
  // Fill any missing key from whatever we successfully resolved so partial
  // failures don't clobber a good existing install with nulls.
  for (const k of ['priority', 'source', 'description'] as const) {
    if (!customFieldIds[k] && install?.customFieldIds?.[k]) {
      customFieldIds[k] = install.customFieldIds[k]!
    }
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
