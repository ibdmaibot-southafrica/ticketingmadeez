import { NextRequest, NextResponse } from 'next/server'
import { COOKIE, readSession } from './lib/security'
export async function proxy(req: NextRequest) {
  const session = readSession(req.cookies.get(COOKIE)?.value)
  const api = req.nextUrl.pathname.startsWith('/api/')
  if (!session) {
    if (api)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      )
    const url = new URL('/auth', req.url)
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search)
    const response = NextResponse.rewrite(url)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  let locationId = req.nextUrl.searchParams.get('locationId')
  if (api && !['GET', 'HEAD'].includes(req.method)) {
    if (
      req.headers.get('origin') !==
      new URL(process.env.APP_BASE_URL || req.nextUrl.origin).origin
    )
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    if (req.method !== 'DELETE') {
      try {
        locationId = (await req.clone().json()).locationId
      } catch {
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
      }
    }
  }
  if (!locationId || locationId !== session.locationId)
    return NextResponse.json(
      { error: 'Location access denied' },
      { status: 403 },
    )
  if (
    req.nextUrl.pathname.startsWith('/api/departments') &&
    session.role !== 'admin'
  )
    return NextResponse.json(
      { error: 'Administrator access required' },
      { status: 403 },
    )
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
export const config = {
  matcher: [
    '/settings/:path*',
    '/api/tickets/:path*',
    '/api/departments/:path*',
    '/api/workspace/:path*',
  ],
}
