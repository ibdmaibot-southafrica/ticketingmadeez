import { createHmac, timingSafeEqual } from 'node:crypto'
import { getPool } from './kv'
export function verifyNexConnect(raw:string,time:string|null,signature:string|null,now=Date.now()) {
 const secret=process.env.NEXCONNECT_INTEGRATION_SECRET
 if(!secret||secret.length<32||!time||!signature||!/^\d{13}$/.test(time)||Math.abs(now-Number(time))>300000||!/^[0-9a-f]{64}$/.test(signature))return false
 const expected=createHmac('sha256',secret).update(time+'.'+raw).digest(),actual=Buffer.from(signature,'hex')
 return actual.length===expected.length && timingSafeEqual(actual,expected)
}
export async function readyNexConnect() {
 await getPool().query(`CREATE TABLE IF NOT EXISTS tmez_nexconnect_tickets(application_id UUID PRIMARY KEY,ticket_no BIGSERIAL UNIQUE,location_id TEXT NOT NULL,company_id TEXT NOT NULL,version INTEGER NOT NULL,data JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS tmez_nexconnect_scope ON tmez_nexconnect_tickets(location_id,company_id);`)
}
export function ticketReference(value:string|number){return 'NC-'+String(value).padStart(6,'0')}
