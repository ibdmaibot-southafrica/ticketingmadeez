import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInstall } from '@/lib/kv'
import { makeDepartmentId, upsertDepartment } from '@/lib/departments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CreateSchema = z.object({
  locationId: z.string().min(1),
  name: z.string().min(1).max(60),
  pipelineId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { locationId, name, pipelineId } = parsed.data
  const install = await getInstall(locationId)
  if (!install) return NextResponse.json({ error: 'No install for this location' }, { status: 404 })
  if (install.plan !== 'paid') {
    return NextResponse.json({ error: 'Adding departments is a Pro tier feature.' }, { status: 402 })
  }
  const departments = await upsertDepartment(locationId, {
    id: makeDepartmentId(name),
    name,
    pipelineId,
    sla: { firstResponseMinutes: 60, resolutionMinutes: 1440, active: false },
  })
  return NextResponse.json({ ok: true, departments })
}
