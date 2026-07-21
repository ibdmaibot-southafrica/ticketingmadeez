import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, persistTokenResponse } from '@/lib/ghl'
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
    const { locationIds } = await persistTokenResponse(tokens)

    if (locationIds.length === 0) {
      return NextResponse.redirect(`${env.APP_BASE_URL}/install/partial`)
    }

    const provisionFailures: string[] = []
    for (const locationId of locationIds) {
      try {
        await provisionLocation(locationId)
      } catch (provisionErr) {
        console.error(`[oauth/callback] provision failed for ${locationId}`, provisionErr)
        provisionFailures.push(locationId)
      }
    }

    const firstLocation = locationIds[0]
    if (provisionFailures.length === locationIds.length) {
      return NextResponse.redirect(
        `${env.APP_BASE_URL}/install/partial?locationId=${firstLocation}`,
      )
    }
    return NextResponse.redirect(
      `${env.APP_BASE_URL}/install/success?locationId=${firstLocation}`,
    )
  } catch (e) {
    console.error('[oauth/callback] failed', e)
    return NextResponse.redirect(`${env.APP_BASE_URL}/install/error?reason=exchange_failed`)
  }
}
