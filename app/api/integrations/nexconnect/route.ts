import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPool, getInstall } from '@/lib/kv'
import { COOKIE, readSession } from '@/lib/security'
import { readyNexConnect, verifyNexConnect, ticketReference, trustedNexConnectKey } from '@/lib/nexconnect'
export const dynamic='force-dynamic'
const schema=z.object({applicationId:z.string().uuid(),locationId:z.string().regex(/^[a-zA-Z0-9]{10,40}$/),companyId:z.string().regex(/^[a-zA-Z0-9]{10,40}$/),version:z.number().int().positive(),status:z.enum(['draft','queued','submitting','requirements_confirmation','needs_provider_setup','provider_review','reconciliation_required','under_review','approved','needs_details','disconnected']),businessType:z.enum(['sole_prop','business']).nullable(),bundleSid:z.string().regex(/^BU[0-9a-fA-F]{32}$/).nullable(),phoneNumber:z.string().regex(/^\+[1-9]\d{6,14}$/).nullable()}).strict()
export async function POST(req:Request) {
 const raw=await req.text()
 if(raw.length>10000)return NextResponse.json({error:'Payload too large'},{status:413})
 const time=req.headers.get('x-nexconnect-time'),signature=req.headers.get('x-nexconnect-signature')
 if(!time||!signature||Math.abs(Date.now()-Number(time))>300000)return NextResponse.json({error:'Invalid integration signature'},{status:401})
 let key:string;try{key=await trustedNexConnectKey()}catch{return NextResponse.json({error:'Publisher verification unavailable'},{status:503})}
 if(!verifyNexConnect(raw,time,signature,key))return NextResponse.json({error:'Invalid integration signature'},{status:401})
 let payload:unknown;try{payload=JSON.parse(raw)}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const input=schema.safeParse(payload);if(!input.success)return NextResponse.json({error:'Invalid setup event'},{status:400})
 const d=input.data;await readyNexConnect()
 await getPool().query(`INSERT INTO tmez_nexconnect_tickets(application_id,location_id,company_id,version,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(application_id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data,updated_at=NOW() WHERE tmez_nexconnect_tickets.location_id=EXCLUDED.location_id AND tmez_nexconnect_tickets.company_id=EXCLUDED.company_id AND tmez_nexconnect_tickets.version<EXCLUDED.version`,[d.applicationId,d.locationId,d.companyId,d.version,{status:d.status,businessType:d.businessType,bundleSid:d.bundleSid,phoneNumber:d.phoneNumber}])
 const result=await getPool().query('SELECT ticket_no,company_id,location_id FROM tmez_nexconnect_tickets WHERE application_id=$1',[d.applicationId]),row=result.rows[0]
 if(row.company_id!==d.companyId || row.location_id!==d.locationId)return NextResponse.json({error:'Ticket ownership mismatch'},{status:409})
 return NextResponse.json({ticketId:ticketReference(row.ticket_no)})
}
export async function GET(req:NextRequest) {
 const s=readSession(req.cookies.get(COOKIE)?.value)
 if(!s)return NextResponse.json({error:'Authentication required'},{status:401})
 const install=await getInstall(s.locationId)
 if(!install?.companyId)return NextResponse.json({error:'Ticketing installation required'},{status:403})
 await readyNexConnect()
 const owner=s.agencyOwner===true&&s.role==='admin'
 const result=await getPool().query('SELECT application_id,ticket_no,location_id,data,updated_at FROM tmez_nexconnect_tickets WHERE (location_id=$1 OR $3::boolean) AND company_id=$2 ORDER BY updated_at DESC LIMIT 100',[s.locationId,install.companyId,owner])
 const crmOrigin=install.companyId==='Htvz9qJFuz8bcVVCDoyv'?'https://ai.nexbdm.com':'https://app.gohighlevel.com'
 return NextResponse.json({agencyView:owner,tickets:result.rows.map(r=>({applicationId:r.application_id,ticketId:ticketReference(r.ticket_no),...r.data,updatedAt:r.updated_at,setupUrl:`${crmOrigin}/v2/location/${r.location_id}/custom-page-link/6aec368cf6ecb7374be74187`})),setupUrl:`${crmOrigin}/v2/location/${s.locationId}/custom-page-link/6aec368cf6ecb7374be74187`})
}
