import { randomUUID } from 'node:crypto'
import { getPool } from './kv'
import { listHubItems, saveHubItem } from './hub-store'
import { DEFAULT_AI_SETTINGS, type AiSettings } from './ai-config'
const SETTINGS_ID = '00000000-0000-4000-8000-000000000001'
const MONTH =
  "date_trunc('month',NOW() AT TIME ZONE 'Africa/Johannesburg')::date"
const DDL = `
CREATE TABLE IF NOT EXISTS tmez_ai_monthly_usage(location_id TEXT NOT NULL,month DATE NOT NULL,spent_micros BIGINT NOT NULL DEFAULT 0,reserved_micros BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(location_id,month));
CREATE TABLE IF NOT EXISTS tmez_ai_requests(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,month DATE NOT NULL,reserved_micros BIGINT NOT NULL,state TEXT NOT NULL DEFAULT 'reserved');
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
export async function getAiSettings(locationId: string) {
  return (
    (await listHubItems<AiSettings>(locationId, 'ai-settings'))[0]?.data ?? {
      ...DEFAULT_AI_SETTINGS,
    }
  )
}
export async function saveAiSettings(locationId: string, settings: AiSettings) {
  await saveHubItem(locationId, 'ai-settings', settings, SETTINGS_ID)
}
export async function getAiBudget(locationId: string) {
  await ready()
  const result = await getPool().query(
    `SELECT spent_micros::float8 AS "spentMicros",reserved_micros::float8 AS "reservedMicros" FROM tmez_ai_monthly_usage WHERE location_id=$1 AND month=${MONTH}`,
    [locationId],
  )
  return result.rows[0] ?? { spentMicros: 0, reservedMicros: 0 }
}
export async function reserveAiBudget(
  locationId: string,
  amount: number,
  limitUsd: number,
) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    !Number.isFinite(limitUsd) ||
    limitUsd < 0 ||
    limitUsd > 500
  )
    throw new Error('Invalid AI budget reservation')
  await ready()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO tmez_ai_monthly_usage(location_id,month) VALUES($1,${MONTH}) ON CONFLICT DO NOTHING`,
      [locationId],
    )
    const result = await client.query(
      `UPDATE tmez_ai_monthly_usage SET reserved_micros=reserved_micros+$2 WHERE location_id=$1 AND month=${MONTH} AND spent_micros+reserved_micros+$2<=$3 RETURNING month`,
      [locationId, amount, Math.round(limitUsd * 1000000)],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      return null
    }
    const id = randomUUID()
    await client.query(
      `INSERT INTO tmez_ai_requests(id,location_id,month,reserved_micros) VALUES($1,$2,${MONTH},$3)`,
      [id, locationId, amount],
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
export async function settleAiBudget(
  locationId: string,
  id: string,
  costMicros: number,
) {
  if (!Number.isSafeInteger(costMicros) || costMicros < 0)
    throw new Error('Invalid AI usage cost')
  await ready()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      "UPDATE tmez_ai_requests SET state='settled' WHERE location_id=$1 AND id=$2 AND state='reserved' RETURNING month,reserved_micros::float8 AS reserved",
      [locationId, id],
    )
    const row = result.rows[0]
    if (row) {
      await client.query(
        'UPDATE tmez_ai_monthly_usage SET reserved_micros=reserved_micros-$3,spent_micros=spent_micros+$4 WHERE location_id=$1 AND month=$2',
        [locationId, row.month, row.reserved, costMicros],
      )
      if (costMicros > row.reserved)
        await client.query(
          "UPDATE tmez_hub_items SET data=jsonb_set(data,'{enabled}','false'::jsonb),updated_at=NOW() WHERE location_id=$1 AND kind='ai-settings' AND id=$2",
          [locationId, SETTINGS_ID],
        )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
