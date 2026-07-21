import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteInstall, getInstall, updateInstall, type PlanTier } from '@/lib/kv'
import { provisionLocation, deprovisionLocation } from '@/lib/provisioning'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const eventSchema = z.object({
  type: z.string(),
  locationId: z.string().optional(),
  companyId: z.string().optional(),
  appId: z.string().optional(),
  planId: z.string().optional(),
  plan: z.string().optional(),
  status: z.string().optional(),
})

function planFromPayload(p: { planId?: string; plan?: string; status?: string }): PlanTier {
  const raw = (p.plan ?? p.planId ?? '').toString().toLowerCase()
  if (raw.includes('paid') || raw.includes('pro') || raw.includes('premium')) return 'paid'
  if (p.status && ['cancelled', 'canceled', 'expired', 'inactive'].includes(p.status.toLowerCase())) return 'free'
  return 'free'
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) {
    console.warn('[webhook] unrecognized payload shape', parsed.error.flatten())
    return NextResponse.json({ ok: true, ignored: true })
  }

  const evt = parsed.data
  const type = evt.type.toUpperCase()

  try {
    switch (type) {
      case 'INSTALL':
      case 'APP.INSTALLED':
      case 'APPINSTALL': {
        if (evt.locationId) {
          const existing = await getInstall(evt.locationId)
          if (existing && !existing.pipelineId) {
            await provisionLocation(evt.locationId).catch((e) =>
              console.error('[webhook install] provision failed', e),
            )
          }
        }
        break
      }
      case 'UNINSTALL':
      case 'APP.UNINSTALLED':
      case 'APPUNINSTALL': {
        if (evt.locationId) {
          await deprovisionLocation(evt.locationId)
          await deleteInstall(evt.locationId)
        }
        break
      }
      case 'PLAN_UPDATED':
      case 'PLAN.UPDATED':
      case 'PLANUPDATED':
      case 'SUBSCRIPTION.UPDATED': {
        if (evt.locationId) {
          const plan = planFromPayload(evt)
          await updateInstall(evt.locationId, { plan })
        }
        break
      }
      default:
        // Unknown event, ack so GHL stops retrying but log for triage.
        console.log('[webhook] unhandled event type', type)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[webhook] handler error', e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
