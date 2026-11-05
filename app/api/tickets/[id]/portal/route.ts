import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, readSession } from '@/lib/security'
import { ticketAccess } from '@/lib/ticket-access'
import {
  createPortalGrant,
  listPortalGrants,
  revokePortalGrant,
} from '@/lib/portal-store'
import { getFeaturePlan } from '@/lib/entitlements'
import { isPaidTier } from '@/lib/kv'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const Schema = z
  .object({
    locationId: z.string().min(1),
    revokeId: z.string().uuid().optional(),
  })
  .strict()
type Context = { params: Promise<{ id: string }> }
export async function GET(req: NextRequest, context: Context) {
  const locationId = req.nextUrl.searchParams.get('locationId')!,
    session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId || session.role !== 'admin')
    return NextResponse.json(
      { error: 'Administrator access required' },
      { status: 403 },
    )
  const { id } = await context.params
  try {
    const access = await ticketAccess(locationId, id)
    if (!access)
      return NextResponse.json(
        { error: 'Ticket access denied' },
        { status: 403 },
      )
    return NextResponse.json({
      grants: await listPortalGrants(locationId, id),
    })
  } catch {
    return NextResponse.json(
      { error: 'Portal access list unavailable' },
      { status: 503 },
    )
  }
}
export async function POST(req: NextRequest, context: Context) {
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { locationId, revokeId } = parsed.data,
    session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId || session.role !== 'admin')
    return NextResponse.json(
      { error: 'Administrator access required' },
      { status: 403 },
    )
  const { id } = await context.params
  try {
    const access = await ticketAccess(locationId, id)
    if (!access)
      return NextResponse.json(
        { error: 'Ticket access denied' },
        { status: 403 },
      )
    if (revokeId) {
      await revokePortalGrant(locationId, id, revokeId)
      return NextResponse.json({ ok: true })
    }
    if (!isPaidTier(getFeaturePlan(access.install)))
      return NextResponse.json(
        { error: 'Customer portal access requires Pro or Enterprise' },
        { status: 402 },
      )
    const grant = await createPortalGrant(locationId, id)
    // A fragment keeps the one-use invite out of server URL logs and referrers.
    return NextResponse.json({
      id: grant.id,
      url: `${new URL(process.env.APP_BASE_URL!).origin}/portal#${grant.token}`,
    })
  } catch {
    return NextResponse.json(
      { error: 'Unable to update portal access' },
      { status: 503 },
    )
  }
}
