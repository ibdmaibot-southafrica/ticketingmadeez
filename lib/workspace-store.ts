import { randomUUID } from 'node:crypto'
import { getPool } from './kv'

// All workspace records are keyed by location. These never enter CRM contact notes.
const DDL = `
CREATE TABLE IF NOT EXISTS tmez_ticket_details (
 location_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
 data JSONB NOT NULL DEFAULT '{}', PRIMARY KEY(location_id, ticket_id)
);
CREATE TABLE IF NOT EXISTS tmez_ticket_activity (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, kind TEXT NOT NULL,
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tmez_ticket_activity_scope ON tmez_ticket_activity(location_id, ticket_id, created_at);
CREATE TABLE IF NOT EXISTS tmez_ticket_files (
 id TEXT PRIMARY KEY, location_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
 name TEXT NOT NULL, mime TEXT NOT NULL, content BYTEA NOT NULL,
 actor_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tmez_ticket_files_scope ON tmez_ticket_files(location_id, ticket_id);
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
export type TicketDetails = {
  firstResponseAt?: string
  resolvedAt?: string | null
  dueAt?: string | null
}
export type Activity = {
  id: string
  actorId: string
  actorName: string
  kind: string
  body: string
  createdAt: string
}
export type TicketFile = {
  id: string
  name: string
  mime: string
  size: number
  createdAt: string
}
export async function getTicketDetails(
  locationId: string,
  ticketIds: string[],
) {
  await ready()
  if (!ticketIds.length) return new Map<string, TicketDetails>()
  const result = await getPool().query<{
    ticket_id: string
    data: TicketDetails
  }>(
    'SELECT ticket_id, data FROM tmez_ticket_details WHERE location_id=$1 AND ticket_id=ANY($2::text[])',
    [locationId, ticketIds],
  )
  return new Map(result.rows.map((r) => [r.ticket_id, r.data]))
}
export async function readTicketWorkspace(
  locationId: string,
  ticketId: string,
) {
  await ready()
  const [details, activity, files] = await Promise.all([
    getTicketDetails(locationId, [ticketId]),
    getPool().query(
      'SELECT id, actor_id AS "actorId", actor_name AS "actorName", kind, body, created_at AS "createdAt" FROM tmez_ticket_activity WHERE location_id=$1 AND ticket_id=$2 ORDER BY created_at DESC, id DESC LIMIT 200',
      [locationId, ticketId],
    ),
    getPool().query(
      'SELECT id, name, mime, octet_length(content) AS size, created_at AS "createdAt" FROM tmez_ticket_files WHERE location_id=$1 AND ticket_id=$2 ORDER BY created_at DESC',
      [locationId, ticketId],
    ),
  ])
  return {
    details: details.get(ticketId) ?? {},
    activity: activity.rows as Activity[],
    files: files.rows as TicketFile[],
  }
}
export async function recordTicketActivity(input: {
  locationId: string
  ticketId: string
  actorId: string
  actorName: string
  kind: string
  body: string
  patch?: TicketDetails
  firstResponse?: boolean
}) {
  await ready()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const {
      locationId,
      ticketId,
      patch,
      firstResponse,
      actorId,
      actorName,
      kind,
      body,
    } = input
    if (patch || firstResponse) {
      await client.query(
        `INSERT INTO tmez_ticket_details(location_id,ticket_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [locationId, ticketId],
      )
      // The first confirmed response is immutable, even if users click concurrently.
      await client.query(
        `UPDATE tmez_ticket_details SET data = data || $3::jsonb || CASE WHEN $4 AND NOT data ? 'firstResponseAt' THEN jsonb_build_object('firstResponseAt', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ELSE '{}'::jsonb END WHERE location_id=$1 AND ticket_id=$2`,
        [locationId, ticketId, JSON.stringify(patch ?? {}), !!firstResponse],
      )
    }
    await client.query(
      'INSERT INTO tmez_ticket_activity(id,location_id,ticket_id,actor_id,actor_name,kind,body) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), locationId, ticketId, actorId, actorName, kind, body],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
export async function storeTicketFile(input: {
  locationId: string
  ticketId: string
  actorId: string
  name: string
  mime: string
  content: Buffer
}) {
  await ready()
  const id = randomUUID()
  // Cap each ticket at 20 files. Advisory locking makes the quota safe under concurrency.
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [input.locationId + ':' + input.ticketId],
    )
    const count = await client.query(
      'SELECT COUNT(*)::int AS count FROM tmez_ticket_files WHERE location_id=$1 AND ticket_id=$2',
      [input.locationId, input.ticketId],
    )
    if (count.rows[0].count >= 20)
      throw new Error('This ticket already has 20 files.')
    await client.query(
      'INSERT INTO tmez_ticket_files(id,location_id,ticket_id,actor_id,name,mime,content) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        input.locationId,
        input.ticketId,
        input.actorId,
        input.name,
        input.mime,
        input.content,
      ],
    )
    await client.query('COMMIT')
    return id
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
export async function readTicketFile(
  locationId: string,
  ticketId: string,
  fileId: string,
) {
  await ready()
  const result = await getPool().query<{
    name: string
    mime: string
    content: Buffer
  }>(
    'SELECT name,mime,content FROM tmez_ticket_files WHERE location_id=$1 AND ticket_id=$2 AND id=$3',
    [locationId, ticketId, fileId],
  )
  return result.rows[0] ?? null
}
