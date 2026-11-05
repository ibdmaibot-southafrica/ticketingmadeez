import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ticketAccess } from '@/lib/ticket-access'
import { getPipeline, mapOpportunityToTicket } from '@/lib/ghl-data'
import {
  readTicketWorkspace,
  recordTicketActivity,
} from '@/lib/workspace-store'
import { COOKIE, readSession } from '@/lib/security'
import { displayName, listActiveUsers } from '@/lib/users'
import { getFeaturePlan } from '@/lib/entitlements'
import { isPaidTier } from '@/lib/kv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(req: NextRequest, context: Context) {
  const { id } = await context.params
  const locationId = req.nextUrl.searchParams.get('locationId')!
  try {
    const access = await ticketAccess(locationId, id)
    if (!access)
      return NextResponse.json(
        { error: 'Ticket access denied' },
        { status: 403 },
      )
    const [workspace, pipeline, users] = await Promise.all([
      readTicketWorkspace(locationId, id),
      getPipeline(locationId, access.opportunity.pipelineId),
      listActiveUsers(locationId),
    ])
    if (!pipeline)
      return NextResponse.json(
        { error: 'Support pipeline is unavailable' },
        { status: 503 },
      )
    const names = new Map(users.map((u) => [u.id, displayName(u)]))
    return NextResponse.json({
      admin: readSession(req.cookies.get(COOKIE)?.value)?.role === 'admin',
      ...workspace,
      ticket: mapOpportunityToTicket(
        access.opportunity,
        pipeline.stages,
        access.install.customFieldIds,
        names,
      ),
      stages: pipeline.stages.slice().sort((a, b) => a.position - b.position),
      users: users.map((u) => ({ id: u.id, name: displayName(u) })),
      department: access.department?.name ?? 'Support',
      sla: isPaidTier(getFeaturePlan(access.install))
        ? access.department?.sla
        : undefined,
    })
  } catch {
    return NextResponse.json(
      { error: 'Unable to load this ticket. Please try again.' },
      { status: 503 },
    )
  }
}
const Schema = z
  .object({
    locationId: z.string().min(1),
    action: z.enum(['note', 'reply', 'first-response', 'due-date']),
    body: z.string().trim().max(10000).optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict()
export async function POST(req: NextRequest, context: Context) {
  const { id } = await context.params
  if (Number(req.headers.get('content-length') || 0) > 20000)
    return NextResponse.json({ error: 'Note is too large' }, { status: 413 })
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { locationId, action, body, dueAt } = parsed.data
  const session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  if ((action === 'note' || action === 'reply') && !body)
    return NextResponse.json(
      { error: 'Write your message first' },
      { status: 400 },
    )
  if (action === 'due-date' && dueAt === undefined)
    return NextResponse.json(
      { error: 'Choose a due date or clear it' },
      { status: 400 },
    )
  try {
    const access = await ticketAccess(locationId, id)
    if (!access)
      return NextResponse.json(
        { error: 'Ticket access denied' },
        { status: 403 },
      )
    const users = await listActiveUsers(locationId)
    const actor = users.find((u) => u.id === session.userId)
    await recordTicketActivity({
      locationId,
      ticketId: id,
      actorId: session.userId,
      actorName: actor ? displayName(actor) : 'Account team member',
      kind: action === 'reply' ? 'team-reply' : action,
      body:
        action === 'note' || action === 'reply'
          ? body!
          : action === 'first-response'
            ? 'Confirmed the first customer response was sent. No message is sent by this action.'
            : dueAt
              ? `Due date set to ${dueAt}`
              : 'Due date cleared',
      firstResponse: action === 'first-response' || action === 'reply',
      patch: action === 'due-date' ? { dueAt } : undefined,
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: 'Unable to save this update. Please try again.' },
      { status: 503 },
    )
  }
}
