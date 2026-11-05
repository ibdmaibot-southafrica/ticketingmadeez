import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ticketAccess } from '@/lib/ticket-access'
import { validateTicketFile } from '@/lib/ticket-files'
import {
  storeTicketFile,
  readTicketFile,
  recordTicketActivity,
} from '@/lib/workspace-store'
import { COOKIE, readSession } from '@/lib/security'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const Schema = z
  .object({
    locationId: z.string().min(1),
    name: z.string().min(1).max(120),
    mime: z.string(),
    content: z.string().max(2800000),
  })
  .strict()
export async function POST(req: NextRequest, context: Context) {
  if (Number(req.headers.get('content-length') || 0) > 2850000)
    return NextResponse.json(
      { error: 'File exceeds the 2 MB limit' },
      { status: 413 },
    )
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid file upload' }, { status: 400 })
  const { locationId, name, mime, content } = parsed.data
  const { id } = await context.params
  const session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  let bytes: Buffer
  try {
    bytes = validateTicketFile(name, mime, content)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  try {
    if (!(await ticketAccess(locationId, id)))
      return NextResponse.json(
        { error: 'Ticket access denied' },
        { status: 403 },
      )
    await storeTicketFile({
      locationId,
      ticketId: id,
      actorId: session.userId,
      name,
      mime,
      content: bytes,
    })
    await recordTicketActivity({
      locationId,
      ticketId: id,
      actorId: session.userId,
      actorName: 'Account team member',
      kind: 'file',
      body: `Attached ${name}`,
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      {
        error:
          'Unable to attach this file. Check the 20-file limit and try again.',
      },
      { status: 503 },
    )
  }
}
export async function GET(req: NextRequest, context: Context) {
  const locationId = req.nextUrl.searchParams.get('locationId')!,
    fileId = req.nextUrl.searchParams.get('fileId')
  const { id } = await context.params
  if (!fileId)
    return NextResponse.json({ error: 'File ID required' }, { status: 400 })
  try {
    if (!(await ticketAccess(locationId, id)))
      return NextResponse.json(
        { error: 'Ticket access denied' },
        { status: 403 },
      )
    const file = await readTicketFile(locationId, id, fileId)
    if (!file)
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File unavailable' }, { status: 503 })
  }
}
