import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteInstall, getInstall, updateInstall, type PlanTier } from '@/lib/kv'
import { provisionLocation, deprovisionLocation } from '@/lib/provisioning'
import { autoAssignOpportunity } from '@/lib/assignment'

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
  // OpportunityCreate / OpportunityUpdate payloads: GHL sends the full opp
  // fields at the top level, not nested. Peel out what we care about.
  id: z.string().optional(),
  opportunityId: z.string().optional(),
  pipelineId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  assignedTo: z.string().nullable().optional(),
})

function planFromPayload(p: { planId?: string; plan?: string; status?: string }): PlanTier {
  const raw = (p.plan ?? p.planId ?? '').toString().toLowerCase()
  if (p.status && ['cancelled', 'canceled', 'expired', 'inactive'].includes(p.status.toLowerCase())) return 'free'
  if (raw.includes('enterprise') || raw.includes('business')) return 'enterprise'
  if (raw.includes('paid') || raw.includes('pro') || raw.includes('premium')) return 'paid'
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
      case 'OPPORTUNITYCREATE':
      case 'OPPORTUNITY.CREATE':
      case 'OPPORTUNITY_CREATE':
      case 'OPPORTUNITYCREATED':
      case 'OPPORTUNITY.CREATED': {
        const opportunityId = evt.id ?? evt.opportunityId
        if (evt.locationId && opportunityId && evt.pipelineId) {
          const result = await autoAssignOpportunity({
            locationId: evt.locationId,
            opportunityId,
            pipelineId: evt.pipelineId,
            currentAssignedTo: evt.assignedTo ?? null,
          }).catch((e) => {
            console.error('[webhook opportunity create] auto-assign failed', e)
            return { skipped: 'error' as const }
          })
          console.log(`[webhook opportunity create] opp=${opportunityId} result=${JSON.stringify(result)}`)
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
