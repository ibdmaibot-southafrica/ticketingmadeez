import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  consumePortalInvite,
  readPortalSession,
  PORTAL_COOKIE,
} from '@/lib/portal-store'
import { ticketAccess } from '@/lib/ticket-access'
import { getPipeline } from '@/lib/ghl-data'
import {
  readTicketWorkspace,
  recordTicketActivity,
} from '@/lib/workspace-store'
import { listHubItems, type Article } from '@/lib/hub-store'
import { isPaidTier } from '@/lib/kv'
import { getFeaturePlan } from '@/lib/entitlements'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
}
const Schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('sign-in'),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('reply'),
      body: z.string().trim().min(1).max(10000),
    })
    .strict(),
  z.object({ action: z.literal('sign-out') }).strict(),
])
export async function GET(req: NextRequest) {
  try {
    const session = await readPortalSession(
      req.cookies.get(PORTAL_COOKIE)?.value,
    )
    if (!session)
      return NextResponse.json(
        {
          error:
            'This support link has expired or was revoked. Ask your support team for a new link.',
        },
        { status: 401, headers },
      )
    const access = await ticketAccess(session.locationId, session.ticketId)
    if (!access || !isPaidTier(getFeaturePlan(access.install)))
      return NextResponse.json(
        {
          error:
            'This support portal is unavailable. Contact your support team.',
        },
        { status: 403, headers },
      )
    const [workspace, pipeline, articles] = await Promise.all([
      readTicketWorkspace(session.locationId, session.ticketId),
      getPipeline(session.locationId, access.opportunity.pipelineId),
      listHubItems<Article>(session.locationId, 'article'),
    ])
    // Never return staff notes, files, assignments, rates, other tickets or draft articles.
    return NextResponse.json(
      {
        ticket: {
          id: session.ticketId,
          subject: access.opportunity.name,
          stage:
            pipeline?.stages.find(
              (s) => s.id === access.opportunity.pipelineStageId,
            )?.name || 'Open',
        },
        messages: workspace.activity
          .filter((a) => a.kind === 'customer-reply' || a.kind === 'team-reply')
          .map((a) => ({
            id: a.id,
            body: a.body,
            from: a.kind === 'customer-reply' ? 'Customer' : 'Support team',
            createdAt: a.createdAt,
          })),
        articles: articles
          .filter((a) => a.data.published)
          .map((a) => ({ id: a.id, title: a.data.title, body: a.data.body })),
      },
      { headers },
    )
  } catch {
    return NextResponse.json(
      { error: 'Support portal is temporarily unavailable' },
      { status: 503, headers },
    )
  }
}
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== new URL(process.env.APP_BASE_URL!).origin)
    return NextResponse.json(
      { error: 'Invalid origin' },
      { status: 403, headers },
    )
  if (Number(req.headers.get('content-length') || 0) > 20000)
    return NextResponse.json(
      { error: 'Message is too long' },
      { status: 413, headers },
    )
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid portal request' },
      { status: 400, headers },
    )
  try {
    if (parsed.data.action === 'sign-out') {
      const response = NextResponse.json({ ok: true }, { headers })
      response.cookies.set(PORTAL_COOKIE, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/portal',
        maxAge: 0,
      })
      return response
    }
    if (parsed.data.action === 'sign-in') {
      const token = await consumePortalInvite(parsed.data.token)
      if (!token)
        return NextResponse.json(
          {
            error:
              'This invite was already used, expired or revoked. Ask for a new support link.',
          },
          { status: 401, headers },
        )
      const response = NextResponse.json({ ok: true }, { headers })
      response.cookies.set(PORTAL_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/portal',
        maxAge: 7 * 24 * 3600,
      })
      return response
    }
    const session = await readPortalSession(
      req.cookies.get(PORTAL_COOKIE)?.value,
    )
    if (!session)
      return NextResponse.json(
        { error: 'Support access has expired' },
        { status: 401, headers },
      )
    const access = await ticketAccess(session.locationId, session.ticketId)
    if (!access || !isPaidTier(getFeaturePlan(access.install)))
      return NextResponse.json(
        { error: 'Support portal unavailable' },
        { status: 403, headers },
      )
    await recordTicketActivity({
      locationId: session.locationId,
      ticketId: session.ticketId,
      actorId: session.grantId,
      actorName: 'Customer through support portal',
      kind: 'customer-reply',
      body: parsed.data.body,
    })
    return NextResponse.json({ ok: true }, { headers })
  } catch {
    return NextResponse.json(
      { error: 'Unable to finish the request. Please try again.' },
      { status: 503, headers },
    )
  }
}
