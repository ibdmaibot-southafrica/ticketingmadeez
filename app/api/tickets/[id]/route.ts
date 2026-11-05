import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInstall } from '@/lib/kv'
import { ghlJson } from '@/lib/ghl'
import { COOKIE, readSession } from '@/lib/security'
import { listActiveUsers, displayName } from '@/lib/users'
import { recordTicketActivity } from '@/lib/workspace-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PatchSchema = z
  .object({
    locationId: z.string().min(1),
    stageId: z.string().min(1).optional(),
    assignedTo: z.string().nullable().optional(),
    status: z.enum(['open', 'won', 'lost', 'abandoned']).optional(),
    priority: z.enum(['Low', 'Normal', 'High', 'Urgent']).optional(),
  })
  .strict()

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', detail: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const { locationId, stageId, assignedTo, status, priority } = parsed.data
  const session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  const install = await getInstall(locationId)
  if (!install)
    return NextResponse.json(
      { error: 'No install for this location' },
      { status: 404 },
    )

  const ticket = await ghlJson<{
    opportunity: { locationId: string; pipelineId: string }
  }>(`/opportunities/${encodeURIComponent(id)}`, {
    locationId,
    method: 'GET',
  }).catch(() => null)
  const allowedPipelines = new Set(
    [
      install.pipelineId,
      ...(install.departments ?? []).map((d) => d.pipelineId),
    ].filter(Boolean),
  )
  if (
    !ticket ||
    ticket.opportunity.locationId !== locationId ||
    !allowedPipelines.has(ticket.opportunity.pipelineId)
  )
    return NextResponse.json({ error: 'Ticket access denied' }, { status: 403 })
  if (stageId) {
    const pipelines = await ghlJson<{
      pipelines: Array<{ id: string; stages: Array<{ id: string }> }>
    }>(
      `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
      { locationId, method: 'GET' },
    )
    if (
      !pipelines.pipelines
        .find((p) => p.id === ticket.opportunity.pipelineId)
        ?.stages.some((s) => s.id === stageId)
    )
      return NextResponse.json(
        { error: 'Invalid ticket stage' },
        { status: 400 },
      )
  }
  const patch: Record<string, unknown> = {}
  const users = await listActiveUsers(locationId)
  if (assignedTo && !users.some((u) => u.id === assignedTo))
    return NextResponse.json(
      { error: 'Choose an active user in this account' },
      { status: 400 },
    )
  if (priority) {
    if (!install.customFieldIds?.priority)
      return NextResponse.json(
        { error: 'Ticket Priority field is not configured' },
        { status: 409 },
      )
    patch.customFields = [
      { id: install.customFieldIds.priority, field_value: priority },
    ]
  }
  if (stageId) patch.pipelineStageId = stageId
  if (assignedTo !== undefined) patch.assignedTo = assignedTo
  if (status) patch.status = status
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    await ghlJson(`/opportunities/${encodeURIComponent(id)}`, {
      locationId,
      method: 'PUT',
      body: JSON.stringify(patch),
    })
    const actor = users.find((u) => u.id === session.userId)
    const changes = [
      stageId ? 'Ticket stage updated' : '',
      assignedTo !== undefined
        ? assignedTo
          ? `Assigned to ${displayName(users.find((u) => u.id === assignedTo)!)}`
          : 'Assignment cleared'
        : '',
      priority ? `Priority set to ${priority}` : '',
    ].filter(Boolean)
    await recordTicketActivity({
      locationId,
      ticketId: id,
      actorId: session.userId,
      actorName: actor ? displayName(actor) : 'Account team member',
      kind: 'update',
      body: changes.join('. ') || `Status set to ${status}`,
      patch: status
        ? {
            resolvedAt:
              status === 'won' || status === 'lost'
                ? new Date().toISOString()
                : null,
          }
        : undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Unable to finish the update. Refresh the ticket before trying again.',
      },
      { status: 503 },
    )
  }
}
