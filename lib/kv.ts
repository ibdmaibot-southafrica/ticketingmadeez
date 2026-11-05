import { Pool } from 'pg'
import { env } from './env'

let pool: Pool | null = null
function getPool(): Pool {
  if (pool) return pool
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  })
  return pool
}

export type PlanTier = 'free' | 'paid' | 'enterprise'

// Anything above free unlocks Pro features (departments, SLA, reports, etc.).
export function isPaidTier(plan: PlanTier): boolean {
  return plan === 'paid' || plan === 'enterprise'
}

export type LocationInstall = {
  locationId: string
  companyId?: string
  userId?: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  plan: PlanTier
  installedAt: number
  pipelineId?: string
  customFieldIds?: {
    priority?: string
    source?: string
    description?: string
  }
  departments?: Department[]
  assignment?: AssignmentPolicy
}

export type AssignmentPolicy = {
  enabled: boolean
  strategy: 'round-robin'
  // Users explicitly excluded from the pool (e.g. billing/AI bot accounts).
  excludeUserIds?: string[]
  // Round-robin cursor: index of the last user we assigned in the current
  // (deterministically sorted) user list. Updated on every successful assign.
  lastAssignedIndex?: number
  // Set true once we've added `calendars.readonly` scope + the sub-account has
  // calendars set up. Filters out anyone currently in a busy slot before RR.
  respectCalendarAvailability?: boolean
}

export type Department = {
  id: string
  name: string
  pipelineId: string
  sla?: {
    firstResponseMinutes: number
    resolutionMinutes: number
    active: boolean
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS tmez_installs (
  location_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tmez_webhook_receipts (
  id TEXT PRIMARY KEY,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`

let migrated = false
async function ensureSchema(): Promise<void> {
  if (migrated) return
  await getPool().query(DDL)
  migrated = true
}

export async function getInstall(
  locationId: string,
): Promise<LocationInstall | null> {
  await ensureSchema()
  const res = await getPool().query<{ data: LocationInstall }>(
    'SELECT data FROM tmez_installs WHERE location_id = $1',
    [locationId],
  )
  return res.rows[0]?.data ?? null
}

export async function saveInstall(install: LocationInstall): Promise<void> {
  await ensureSchema()
  await getPool().query(
    `INSERT INTO tmez_installs (location_id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (location_id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = NOW()`,
    [install.locationId, install],
  )
}

export async function updateInstall(
  locationId: string,
  patch: Partial<LocationInstall>,
): Promise<LocationInstall | null> {
  await ensureSchema()
  const { locationId: _ignored, ...safePatch } = patch
  const res = await getPool().query<{ data: LocationInstall }>(
    'UPDATE tmez_installs SET data = data || $2::jsonb, updated_at = NOW() WHERE location_id = $1 RETURNING data',
    [locationId, JSON.stringify(safePatch)],
  )
  return res.rows[0]?.data ?? null
}

export async function deleteInstall(locationId: string): Promise<void> {
  await ensureSchema()
  await getPool().query('DELETE FROM tmez_installs WHERE location_id = $1', [
    locationId,
  ])
}

// Store only a body hash. A failed handler releases its claim so delivery can retry.
export async function claimWebhook(
  id: string,
): Promise<'claimed' | 'completed' | 'busy'> {
  await ensureSchema()
  const result = await getPool().query(
    `INSERT INTO tmez_webhook_receipts (id) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET claimed_at = NOW()
     WHERE NOT tmez_webhook_receipts.completed AND tmez_webhook_receipts.claimed_at < NOW() - INTERVAL '5 minutes'
     RETURNING id`,
    [id],
  )
  if (result.rowCount) return 'claimed'
  const existing = await getPool().query<{ completed: boolean }>(
    'SELECT completed FROM tmez_webhook_receipts WHERE id = $1',
    [id],
  )
  return existing.rows[0]?.completed ? 'completed' : 'busy'
}
export async function finishWebhook(id: string, success: boolean) {
  if (success)
    await getPool().query(
      'UPDATE tmez_webhook_receipts SET completed = TRUE WHERE id = $1',
      [id],
    )
  else
    await getPool().query(
      'DELETE FROM tmez_webhook_receipts WHERE id = $1 AND NOT completed',
      [id],
    )
}
