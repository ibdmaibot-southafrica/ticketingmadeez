import { createCipheriv,createDecipheriv,hkdfSync,randomBytes } from 'node:crypto'
import { getPool } from './kv'
import type { AiProvider } from './ai-config'
const DDL='CREATE TABLE IF NOT EXISTS tmez_ai_credentials(location_id TEXT NOT NULL,provider TEXT NOT NULL,encrypted TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(location_id,provider))'
let migration:Promise<unknown>|undefined
async function ready(){if(!migration)migration=getPool().query(DDL).catch(e=>{migration=undefined;throw e});await migration}
function key(){const secret=process.env.AI_CREDENTIALS_KEY||process.env.SESSION_SECRET;if(!secret||secret.length<32)throw new Error('Credential encryption is not configured');return Buffer.from(hkdfSync('sha256',secret,'ticketingmadeez','customer-ai-keys-v1',32))}
export function encryptAiKey(locationId:string,provider:AiProvider,value:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv)
 cipher.setAAD(Buffer.from(JSON.stringify([locationId,provider])))
 const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()])
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.')
}
export function decryptAiKey(locationId:string,provider:AiProvider,value:string){
 const [version,iv,tag,encrypted,extra]=value.split('.')
 if(version!=='v1'||!iv||!tag||!encrypted||extra)throw new Error('Invalid encrypted credential')
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url'))
 decipher.setAAD(Buffer.from(JSON.stringify([locationId,provider])));decipher.setAuthTag(Buffer.from(tag,'base64url'))
 return Buffer.concat([decipher.update(Buffer.from(encrypted,'base64url')),decipher.final()]).toString('utf8')
}
export async function saveCustomerAiKey(locationId:string,provider:AiProvider,value:string){await ready();await getPool().query('INSERT INTO tmez_ai_credentials(location_id,provider,encrypted) VALUES($1,$2,$3) ON CONFLICT(location_id,provider) DO UPDATE SET encrypted=EXCLUDED.encrypted,updated_at=NOW()',[locationId,provider,encryptAiKey(locationId,provider,value)])}
export async function customerAiKey(locationId:string,provider:AiProvider){await ready();const result=await getPool().query<{encrypted:string}>('SELECT encrypted FROM tmez_ai_credentials WHERE location_id=$1 AND provider=$2',[locationId,provider]);return result.rows[0]?decryptAiKey(locationId,provider,result.rows[0].encrypted):undefined}
export async function customerAiConnections(locationId:string){await ready();return (await getPool().query<{provider:AiProvider;updatedAt:string}>('SELECT provider,updated_at AS "updatedAt" FROM tmez_ai_credentials WHERE location_id=$1',[locationId])).rows}
export async function disconnectCustomerAiKey(locationId:string,provider:AiProvider){
 await ready();const client=await getPool().connect()
 try{await client.query('BEGIN');await client.query('DELETE FROM tmez_ai_credentials WHERE location_id=$1 AND provider=$2',[locationId,provider]);await client.query("UPDATE tmez_hub_items SET data=jsonb_set(data,'{enabled}','false'::jsonb),updated_at=NOW() WHERE location_id=$1 AND kind='ai-settings' AND data->>'provider'=$2",[locationId,provider]);await client.query('COMMIT')}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
