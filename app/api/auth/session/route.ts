import { NextRequest, NextResponse } from 'next/server'
import { COOKIE, decryptContext, signSession } from '@/lib/security'
import { getInstall } from '@/lib/kv'
export async function POST(req: NextRequest) {
  if (
    req.headers.get('origin') !==
    new URL(process.env.APP_BASE_URL || req.nextUrl.origin).origin
  )
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  if (!process.env.GHL_APP_SHARED_SECRET || !process.env.SESSION_SECRET)
    return NextResponse.json(
      { error: 'Secure sign-in is not configured' },
      { status: 503 },
    )
  try {
    const body = await req.json()
    if (
      typeof body.encryptedData !== 'string' ||
      body.encryptedData.length > 20000
    )
      throw new Error()
    const c = decryptContext(
      body.encryptedData,
      process.env.GHL_APP_SHARED_SECRET,
    )
    if (
      typeof c.activeLocation !== 'string' ||
      typeof c.userId !== 'string' ||
      !['admin', 'user'].includes(c.role)
    )
      throw new Error()
    const install = await getInstall(c.activeLocation)
    if (!install || !install.companyId || install.companyId !== c.companyId)
      throw new Error()
    const response = NextResponse.json({ locationId: c.activeLocation })
    response.cookies.set(
      COOKIE,
      signSession({
        locationId: c.activeLocation,
        userId: c.userId,
        role: c.role,
        exp: Date.now() + 15 * 60 * 1000,
      }),
      {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        partitioned: true,
        path: '/',
        maxAge: 900,
      },
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return NextResponse.json(
      { error: 'Unable to verify account access' },
      { status: 401 },
    )
  }
}
