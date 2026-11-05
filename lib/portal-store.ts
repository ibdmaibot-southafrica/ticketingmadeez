import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getPool } from './kv'
const DDL = `
CREATE TABLE IF NOT EXISTS tmez_portal_grants (
 id TEXT PRIMARY KEY,location_id TEXT NOT NULL,ticket_id TEXT NOT NULL,
 invite_hash TEXT NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,
 consumed BOOLEAN NOT NULL DEFAULT FALSE,revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS tmez_portal_sessions (
 token_hash TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES tmez_portal_grants(id),expires_at TIMESTAMPTZ NOT NULL
);
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
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex')
export const PORTAL_COOKIE = 'tmez_customer_session'
export async function createPortalGrant(locationId: string, ticketId: string) {
  await ready()
  const token = randomBytes(32).toString('base64url'),
    id = randomUUID()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      locationId + ':' + ticketId,
    ])
    const count = await client.query(
      'SELECT COUNT(*)::int AS count FROM tmez_portal_grants WHERE location_id=$1 AND ticket_id=$2 AND NOT revoked AND expires_at>NOW()',
      [locationId, ticketId],
    )
    if (count.rows[0].count >= 20)
      throw new Error('Revoke an existing access link before creating another')
    await client.query(
      "INSERT INTO tmez_portal_grants(id,location_id,ticket_id,invite_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')",
      [id, locationId, ticketId, digest(token)],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  return { id, token }
}
export async function consumePortalInvite(token: string) {
  await ready()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      'UPDATE tmez_portal_grants SET consumed=TRUE WHERE invite_hash=$1 AND NOT consumed AND NOT revoked AND expires_at>NOW() RETURNING id,expires_at',
      [digest(token)],
    )
    if (!result.rows[0]) {
      await client.query('ROLLBACK')
      return null
    }
    const session = randomBytes(32).toString('base64url')
    await client.query(
      'INSERT INTO tmez_portal_sessions(token_hash,grant_id,expires_at) VALUES($1,$2,$3)',
      [digest(session), result.rows[0].id, result.rows[0].expires_at],
    )
    await client.query('COMMIT')
    return session
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
export async function readPortalSession(token?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  await ready()
  const result = await getPool().query<{
    locationId: string
    ticketId: string
    grantId: string
  }>(
    'SELECT g.location_id AS "locationId",g.ticket_id AS "ticketId",g.id AS "grantId" FROM tmez_portal_sessions s JOIN tmez_portal_grants g ON g.id=s.grant_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND g.expires_at>NOW() AND NOT g.revoked',
    [digest(token)],
  )
  return result.rows[0] ?? null
}
export async function listPortalGrants(locationId: string, ticketId: string) {
  await ready()
  return (
    await getPool().query(
      'SELECT id,expires_at AS "expiresAt",consumed,revoked FROM tmez_portal_grants WHERE location_id=$1 AND ticket_id=$2 ORDER BY revoked ASC,expires_at DESC LIMIT 30',
      [locationId, ticketId],
    )
  ).rows as {
    id: string
    expiresAt: string
    consumed: boolean
    revoked: boolean
  }[]
}
export async function revokePortalGrant(
  locationId: string,
  ticketId: string,
  id: string,
) {
  await ready()
  await getPool().query(
    'UPDATE tmez_portal_grants SET revoked=TRUE WHERE location_id=$1 AND ticket_id=$2 AND id=$3',
    [locationId, ticketId, id],
  )
}
