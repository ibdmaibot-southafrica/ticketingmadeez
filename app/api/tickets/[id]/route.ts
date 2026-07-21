import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInstall } from '@/lib/kv'
import { ghlJson } from '@/lib/ghl'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PatchSchema = z.object({
  locationId: z.string().min(1),
  stageId: z.string().min(1).optional(),
  assignedTo: z.string().nullable().optional(),
  status: z.enum(['open', 'won', 'lost', 'abandoned']).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { locationId, stageId, assignedTo, status } = parsed.data
  const install = await getInstall(locationId)
  if (!install) return NextResponse.json({ error: 'No install for this location' }, { status: 404 })

  const patch: Record<string, unknown> = {}
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
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
