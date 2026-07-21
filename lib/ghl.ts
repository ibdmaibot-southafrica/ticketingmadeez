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

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${env.GHL_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`OAuth token endpoint failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as TokenResponse
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      client_id: env.GHL_CLIENT_ID,
      client_secret: env.GHL_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  )
}

async function fetchLocationToken(agencyAccessToken: string, companyId: string, locationId: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    companyId,
    locationId,
  })
  const res = await fetch(`${env.GHL_API_BASE}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agencyAccessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Version: env.GHL_API_VERSION,
    },
    body,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`/oauth/locationToken failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as TokenResponse
}

type InstalledLocationsResponse = {
  locations?: Array<{ _id?: string; locationId?: string; name?: string; address?: string; isInstalled?: boolean }>
  installedLocations?: Array<{ _id?: string; locationId?: string; name?: string; address?: string; isInstalled?: boolean }>
}

async function fetchInstalledLocations(agencyAccessToken: string, companyId: string): Promise<string[]> {
  const url = `${env.GHL_API_BASE}/oauth/installedLocations?companyId=${encodeURIComponent(companyId)}&appId=${encodeURIComponent(env.GHL_APP_ID)}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${agencyAccessToken}`,
      Version: env.GHL_API_VERSION,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`/oauth/installedLocations failed (${res.status}): ${detail}`)
  }
  const data = (await res.json()) as InstalledLocationsResponse
  const rows = data.installedLocations ?? data.locations ?? []
  return rows
    .filter((r) => r.isInstalled !== false)
    .map((r) => r.locationId ?? r._id)
    .filter((x): x is string => !!x)
}

export async function refreshLocationToken(install: LocationInstall): Promise<LocationInstall> {
  const t = await postToken(
    new URLSearchParams({
      client_id: env.GHL_CLIENT_ID,
      client_secret: env.GHL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: install.refreshToken,
    }),
  )
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

async function upsertInstallFromToken(t: TokenResponse, locationId: string): Promise<void> {
  const existing = await getInstall(locationId)
  const merged: LocationInstall = existing
    ? {
        // Preserve everything the sub-account configured (plan, pipeline, custom
        // fields, departments, assignment cursor, etc.). Only refresh what the
        // OAuth token actually gives us.
        ...existing,
        companyId: t.companyId ?? existing.companyId,
        userId: t.userId ?? existing.userId,
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000,
      }
    : {
        locationId,
        companyId: t.companyId,
        userId: t.userId,
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000,
        plan: 'free',
        installedAt: Date.now(),
      }
  await saveInstall(merged)
}

export type InstallResult = {
  locationIds: string[]
  companyId?: string
  freshLocationIds: string[]
}

export async function persistTokenResponse(t: TokenResponse): Promise<InstallResult> {
  if (t.locationId) {
    const wasNew = !(await getInstall(t.locationId))
    await upsertInstallFromToken(t, t.locationId)
    return {
      locationIds: [t.locationId],
      companyId: t.companyId,
      freshLocationIds: wasNew ? [t.locationId] : [],
    }
  }
  if (!t.companyId) throw new Error('Token response has neither locationId nor companyId')

  // After a fresh install, GHL's /installedLocations index can take a few seconds
  // to reflect the new install. Retry with backoff before giving up.
  let locationIds: string[] = []
  for (let attempt = 0; attempt < 4; attempt++) {
    locationIds = await fetchInstalledLocations(t.access_token, t.companyId)
    if (locationIds.length > 0) break
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  if (locationIds.length === 0) {
    console.warn(`[persistTokenResponse] /installedLocations still empty after retries for companyId=${t.companyId}; deferring to webhook`)
    return { locationIds: [], companyId: t.companyId, freshLocationIds: [] }
  }
  const saved: string[] = []
  const fresh: string[] = []
  for (const locationId of locationIds) {
    try {
      const wasNew = !(await getInstall(locationId))
      const locToken = await fetchLocationToken(t.access_token, t.companyId, locationId)
      await upsertInstallFromToken({ ...locToken, companyId: t.companyId }, locationId)
      saved.push(locationId)
      if (wasNew) fresh.push(locationId)
    } catch (e) {
      console.error(`[persistTokenResponse] failed for locationId=${locationId}`, e)
    }
  }
  return { locationIds: saved, companyId: t.companyId, freshLocationIds: fresh }
}
