import { createPublicKey, verify, createHash } from 'node:crypto'
import { getPool } from './kv'
const namespace='nexconnect-to-ticketingmadeez:v1:'
export function verifyNexConnect(raw:string,time:string|null,signature:string|null,publicKey:string,now=Date.now()) {
 if(!time||!signature||!/^\d{13}$/.test(time)||Math.abs(now-Number(time))>300000||signature.length>100)return false
 try {const key=createPublicKey(publicKey),bytes=Buffer.from(signature,'base64');return key.asymmetricKeyType==='ed25519' && bytes.length===64 && verify(null,Buffer.from(namespace+time+'.'+raw),key,bytes)}catch{return false}
}
export async function readyNexConnect() {
 await getPool().query(`CREATE TABLE IF NOT EXISTS tmez_nexconnect_tickets(application_id UUID PRIMARY KEY,ticket_no BIGSERIAL UNIQUE,location_id TEXT NOT NULL,company_id TEXT NOT NULL,version INTEGER NOT NULL,data JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS tmez_nexconnect_scope ON tmez_nexconnect_tickets(location_id,company_id); CREATE TABLE IF NOT EXISTS tmez_nexconnect_signers(id TEXT PRIMARY KEY,public_key TEXT NOT NULL);`)
}
let signingKey:Promise<string>|undefined
export async function trustedNexConnectKey():Promise<string> {
 signingKey??=(async()=>{
  // This publisher endpoint is fixed server-side. Never trust a key or URL supplied in a ticket event.
  const response=await fetch('https://v8bjrxlmx5zpirbmpqanobfo.204.168.216.164.sslip.io/api/integration-key',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  if(!response.ok)throw new Error('Publisher verification unavailable')
  const key=await response.json()
  if(key.appId!=='6aec2b78599d2f4acdb3f09d'||typeof key.publicKey!=='string'||key.publicKey.length>1000||createHash('sha256').update(key.publicKey).digest('hex')!==key.keyId||createPublicKey(key.publicKey).asymmetricKeyType!=='ed25519')throw new Error('Invalid publisher key')
  await readyNexConnect()
  await getPool().query(`INSERT INTO tmez_nexconnect_signers(id,public_key) VALUES('nexconnect',$1) ON CONFLICT DO NOTHING`,[key.publicKey])
  const pinned=await getPool().query(`SELECT public_key FROM tmez_nexconnect_signers WHERE id='nexconnect'`)
  if(pinned.rows[0]?.public_key!==key.publicKey)throw new Error('Publisher key rotation requires review')
  return key.publicKey as string
 })().catch(e=>{signingKey=undefined;throw e})
 return signingKey
}
export function ticketReference(value:string|number){return 'NC-'+String(value).padStart(6,'0')}
