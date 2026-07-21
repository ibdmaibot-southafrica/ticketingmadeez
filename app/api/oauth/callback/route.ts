import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, persistInitialInstall } from '@/lib/ghl'
import { provisionLocation } from '@/lib/provisioning'
import { env } from '@/lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${env.APP_BASE_URL}/install/error?reason=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${env.APP_BASE_URL}/install/error?reason=missing_code`)
  }

  try {
    const tokens = await exchangeCode(code)
    await persistInitialInstall(tokens)
    if (tokens.locationId) {
      try {
        await provisionLocation(tokens.locationId)
      } catch (provisionErr) {
        console.error('[oauth/callback] provision failed', provisionErr)
        return NextResponse.redirect(
          `${env.APP_BASE_URL}/install/partial?locationId=${tokens.locationId}`,
        )
      }
    }
    return NextResponse.redirect(
      `${env.APP_BASE_URL}/install/success?locationId=${tokens.locationId ?? ''}`,
    )
  } catch (e) {
    console.error('[oauth/callback] failed', e)
    return NextResponse.redirect(`${env.APP_BASE_URL}/install/error?reason=exchange_failed`)
  }
}
