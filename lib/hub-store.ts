import { randomUUID } from 'node:crypto'
import { getPool } from './kv'

const DDL = `
CREATE TABLE IF NOT EXISTS tmez_hub_items (
 id TEXT NOT NULL, location_id TEXT NOT NULL, kind TEXT NOT NULL,
 data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(location_id,kind,id)
);
CREATE TABLE IF NOT EXISTS tmez_time_entries (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL, user_id TEXT NOT NULL,
 project_id TEXT NOT NULL, description TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 ended_at TIMESTAMPTZ, minutes INTEGER, billable BOOLEAN NOT NULL DEFAULT FALSE,
 rate_minor BIGINT, currency TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tmez_single_running_timer ON tmez_time_entries(location_id,user_id) WHERE ended_at IS NULL;
`
let migration: Promise<unknown> | undefined
async function ready() {
  if (!migration)
    migration = getPool()
      .query(DDL)
      .catch((e) => {
        migration = undefined
        throw e
      })
  await migration
}
export type Article = { title: string; body: string; published: boolean }
export type Project = {
  title: string
  description: string
  status: 'planned' | 'active' | 'completed'
  hourlyRate?: number
  currency?: string
  members?: string[]
  visibility?: 'account' | 'members'
  userRates?: { userId: string; hourlyRate: number; currency: string }[]
}
export type Task = {
  title: string
  projectId: string
  status: 'todo' | 'doing' | 'done'
  assignedTo?: string
  dueAt?: string | null
  ticketId?: string
}
export type HubItem<T> = {
  id: string
  data: T
  createdAt: string
  updatedAt: string
}
export type TimeEntry = {
  id: string
  userId: string
  projectId: string
  description: string
  startedAt: string
  endedAt: string | null
  minutes: number | null
  billable: boolean
  rateMinor: number | null
  currency: string | null
}
export async function listHubItems<T>(locationId: string, kind: string) {
  await ready()
  const result = await getPool().query(
    'SELECT id,data,created_at AS "createdAt",updated_at AS "updatedAt" FROM tmez_hub_items WHERE location_id=$1 AND kind=$2 ORDER BY updated_at DESC LIMIT 500',
    [locationId, kind],
  )
  return result.rows as HubItem<T>[]
}
export async function saveHubItem(
  locationId: string,
  kind: string,
  data: unknown,
  id: string = randomUUID(),
) {
  await ready()
  const result = await getPool().query(
    'INSERT INTO tmez_hub_items(id,location_id,kind,data) VALUES($1,$2,$3,$4) ON CONFLICT(location_id,kind,id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW() RETURNING id',
    [id, locationId, kind, JSON.stringify(data)],
  )
  return result.rows[0].id as string
}
export async function listTimeEntries(locationId: string) {
  await ready()
  return (
    await getPool().query(
      'SELECT id,user_id AS "userId",project_id AS "projectId",description,started_at AS "startedAt",ended_at AS "endedAt",minutes,billable,rate_minor::float8 AS "rateMinor",currency FROM tmez_time_entries WHERE location_id=$1 ORDER BY started_at DESC LIMIT 1000',
      [locationId],
    )
  ).rows as TimeEntry[]
}
export async function startTimer(
  locationId: string,
  userId: string,
  projectId: string,
  description: string,
  billable: boolean,
  rateMinor?: number,
  currency?: string,
) {
  await ready()
  await getPool().query(
    'INSERT INTO tmez_time_entries(id,location_id,user_id,project_id,description,billable,rate_minor,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      randomUUID(),
      locationId,
      userId,
      projectId,
      description,
      billable,
      rateMinor ?? null,
      currency ?? null,
    ],
  )
}
export async function stopTimer(locationId: string, userId: string) {
  await ready()
  const result = await getPool().query(
    'UPDATE tmez_time_entries SET ended_at=NOW(),minutes=GREATEST(1,CEIL(EXTRACT(EPOCH FROM (NOW()-started_at))/60)::int) WHERE location_id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING id',
    [locationId, userId],
  )
  return !!result.rowCount
}
export async function addManualTime(
  locationId: string,
  userId: string,
  projectId: string,
  description: string,
  minutes: number,
  billable: boolean,
  rateMinor?: number,
  currency?: string,
) {
  await ready()
  await getPool().query(
    'INSERT INTO tmez_time_entries(id,location_id,user_id,project_id,description,started_at,ended_at,minutes,billable,rate_minor,currency) VALUES($1,$2,$3,$4,$5,NOW()-make_interval(mins => $6::int),NOW(),$6,$7,$8,$9)',
    [
      randomUUID(),
      locationId,
      userId,
      projectId,
      description,
      minutes,
      billable,
      rateMinor ?? null,
      currency ?? null,
    ],
  )
}
// Amounts use exact minor units and caller-supplied rates. No invoice or charge is created.
export function timeAmountMinor(minutes: number, hourlyRate: number) {
  return Math.round((minutes * Math.round(hourlyRate * 100)) / 60)
}
