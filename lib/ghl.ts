import { env, REDIRECT_URI } from './env'
import { getInstall, saveInstall, updateInstall, type LocationInstall } from './kv'

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  locationId?: string
  companyId?: string
  userId?: string
  userType?: string
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: env.GHL_CLIENT_ID,
    client_secret: env.GHL_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    user_type: 'Location',
  })
  const res = await fetch(`${env.GHL_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`OAuth token exchange failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as TokenResponse
}

export async function refreshLocationToken(install: LocationInstall): Promise<LocationInstall> {
  const body = new URLSearchParams({
    client_id: env.GHL_CLIENT_ID,
    client_secret: env.GHL_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: install.refreshToken,
    user_type: 'Location',
  })
  const res = await fetch(`${env.GHL_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`OAuth token refresh failed (${res.status}): ${detail}`)
  }
  const t = (await res.json()) as TokenResponse
  const updated = await updateInstall(install.locationId, {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? install.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  })
  if (!updated) throw new Error('Install disappeared during refresh')
  return updated
}

export async function getValidToken(locationId: string): Promise<string> {
  const install = await getInstall(locationId)
  if (!install) throw new Error(`No install found for location ${locationId}`)
  if (install.expiresAt - Date.now() > 60_000) return install.accessToken
  const refreshed = await refreshLocationToken(install)
  return refreshed.accessToken
}

type GhlFetchInit = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
  locationId: string
}

export async function ghlFetch(path: string, init: GhlFetchInit): Promise<Response> {
  const token = await getValidToken(init.locationId)
  const { locationId: _lid, headers = {}, ...rest } = init
  return fetch(`${env.GHL_API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: env.GHL_API_VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

export async function ghlJson<T = unknown>(path: string, init: GhlFetchInit): Promise<T> {
  const res = await ghlFetch(path, init)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`GHL ${init.method ?? 'GET'} ${path} failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as T
}

export function persistInitialInstall(t: TokenResponse): Promise<void> {
  if (!t.locationId) throw new Error('Token response missing locationId')
  return saveInstall({
    locationId: t.locationId,
    companyId: t.companyId,
    userId: t.userId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    plan: 'free',
    installedAt: Date.now(),
  })
}
