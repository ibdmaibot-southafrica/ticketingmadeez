import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInstall, isPaidTier } from '@/lib/kv'
import { removeDepartment, upsertDepartment } from '@/lib/departments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PatchSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1).max(60).optional(),
  pipelineId: z.string().min(1).optional(),
  sla: z
    .object({
      firstResponseMinutes: z.number().int().min(1).max(60 * 24 * 30),
      resolutionMinutes: z.number().int().min(1).max(60 * 24 * 30),
      active: z.boolean(),
    })
    .optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { locationId, ...patch } = parsed.data
  const install = await getInstall(locationId)
  if (!install) return NextResponse.json({ error: 'No install for this location' }, { status: 404 })

  const existing = install.departments?.find((d) => d.id === id)
  if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 })

  const isSlaChange = 'sla' in patch && patch.sla !== undefined
  const isStructuralChange = ('name' in patch && patch.name) || ('pipelineId' in patch && patch.pipelineId)

  if (!isPaidTier(install.plan) && (isSlaChange || isStructuralChange)) {
    return NextResponse.json({ error: 'Editing departments/SLA is a Pro tier feature.' }, { status: 402 })
  }

  const next = { ...existing, ...patch }
  const departments = await upsertDepartment(locationId, next)
  return NextResponse.json({ ok: true, departments })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const locationId = req.nextUrl.searchParams.get('locationId')
  if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  const install = await getInstall(locationId)
  if (!install) return NextResponse.json({ error: 'No install for this location' }, { status: 404 })
  if (!isPaidTier(install.plan)) {
    return NextResponse.json({ error: 'Deleting departments is a Pro tier feature.' }, { status: 402 })
  }
  try {
    const departments = await removeDepartment(locationId, id)
    return NextResponse.json({ ok: true, departments })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
