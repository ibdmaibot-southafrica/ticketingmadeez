import { createHash } from 'node:crypto'
import { verifyWebhook, planFromPayload } from '@/lib/security'
import { env } from '@/lib/env'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  deleteInstall,
  getInstall,
  updateInstall,
  claimWebhook,
  finishWebhook,
} from '@/lib/kv'
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
  newPlanId: z.string().optional(),
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

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyWebhook(raw, req.headers.get('x-ghl-signature')))
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    )
  }

  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) {
    console.warn('[webhook] unrecognized payload shape', parsed.error.flatten())
    return NextResponse.json({ ok: true, ignored: true })
  }

  const evt = parsed.data
  if (evt.appId && evt.appId !== env.GHL_APP_ID)
    return NextResponse.json({ error: 'Wrong app' }, { status: 403 })
  const type = evt.type.toUpperCase()
  if (
    [
      'INSTALL',
      'UNINSTALL',
      'PLAN_CHANGE',
      'PLAN_UPDATED',
      'PLAN.UPDATED',
      'PLANUPDATED',
      'SUBSCRIPTION.UPDATED',
      'APP.INSTALLED',
      'APPINSTALL',
      'APP.UNINSTALLED',
      'APPUNINSTALL',
    ].includes(type) &&
    evt.appId !== env.GHL_APP_ID
  )
    return NextResponse.json({ error: 'Wrong app' }, { status: 403 })
  const receipt = createHash('sha256').update(raw).digest('hex')
  const claim = await claimWebhook(receipt)
  if (claim === 'completed')
    return NextResponse.json({ ok: true, duplicate: true })
  if (claim === 'busy')
    return NextResponse.json({ error: 'Event processing' }, { status: 503 })
  let succeeded = false
  try {
    const response = await handleEvent(evt, type)
    succeeded = response.status >= 200 && response.status < 300
    return response
  } finally {
    await finishWebhook(receipt, succeeded)
  }
}

async function handleEvent(evt: z.infer<typeof eventSchema>, type: string) {
  try {
    switch (type) {
      case 'INSTALL':
      case 'APP.INSTALLED':
      case 'APPINSTALL': {
        if (evt.locationId) {
          const existing = await getInstall(evt.locationId)
          if (!existing)
            return NextResponse.json(
              { error: 'Install not ready' },
              { status: 503 },
            )
          if (evt.planId) {
            const plan = planFromPayload(evt)
            if (!plan)
              return NextResponse.json(
                { error: 'Unknown plan ID' },
                { status: 422 },
              )
            await updateInstall(evt.locationId, { plan })
          }
          if (existing && !existing.pipelineId) {
            await provisionLocation(evt.locationId)
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
      case 'PLAN_CHANGE':
      case 'PLAN_UPDATED':
      case 'PLAN.UPDATED':
      case 'PLANUPDATED':
      case 'SUBSCRIPTION.UPDATED': {
        if (evt.locationId) {
          const plan = planFromPayload({
            ...evt,
            planId: evt.newPlanId ?? evt.planId,
          })
          if (!plan)
            return NextResponse.json(
              { error: 'Unknown plan ID' },
              { status: 422 },
            )
          if (!(await updateInstall(evt.locationId, { plan })))
            return NextResponse.json(
              { error: 'Install not ready' },
              { status: 503 },
            )
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
          })
          console.log(
            `[webhook opportunity create] opp=${opportunityId} result=${JSON.stringify(result)}`,
          )
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
