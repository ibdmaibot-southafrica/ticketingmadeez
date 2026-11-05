import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE,readSession } from '@/lib/security'
import { saveCustomerAiKey,disconnectCustomerAiKey } from '@/lib/ai-credentials'
import { aiProviderConfig } from '@/lib/ai-config'
import { getAiSettings,saveAiSettings } from '@/lib/ai-budget'
import { getInstall } from '@/lib/kv'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const Schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('connect'),locationId:z.string().min(1),provider:z.literal('openai'),apiKey:z.string().trim().min(32).max(2048),billingAccepted:z.literal(true)}).strict(),
 z.object({action:z.literal('disconnect'),locationId:z.string().min(1),provider:z.literal('openai')}).strict(),
])
export async function POST(req:NextRequest){
 if(Number(req.headers.get('content-length')||0)>8000)return NextResponse.json({error:'Connection request is too large'},{status:413})
 const parsed=Schema.safeParse(await req.json().catch(()=>null))
 if(!parsed.success)return NextResponse.json({error:'Enter your own OpenAI API key and acknowledge direct AI billing'},{status:400})
 const {locationId,provider}=parsed.data,session=readSession(req.cookies.get(COOKIE)?.value)
 if(!session||session.locationId!==locationId||session.role!=='admin')return NextResponse.json({error:'Administrator access required'},{status:403})
 if(!await getInstall(locationId))return NextResponse.json({error:'Install this app in the account before connecting OpenAI'},{status:404})
 try{
  if(parsed.data.action==='disconnect'){await getAiSettings(locationId);await disconnectCustomerAiKey(locationId,provider);return NextResponse.json({ok:true,message:'OpenAI disconnected. AI is off.'})}
  if(!parsed.data.apiKey.startsWith('sk-'))return NextResponse.json({error:'Use an OpenAI API secret key from the API keys page. Do not use a ChatGPT password.'},{status:400})
  const {model}=aiProviderConfig(provider)
  // Read-only key/model validation. Connecting never generates paid AI output.
  const response=await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model!)}`,{headers:{Authorization:`Bearer ${parsed.data.apiKey}`},signal:AbortSignal.timeout(20000)})
  if(!response.ok)return NextResponse.json({error:'OpenAI could not confirm access to the recommended model. Check the key, its project permissions and model access.'},{status:400})
  await saveCustomerAiKey(locationId,provider,parsed.data.apiKey)
  const settings=await getAiSettings(locationId)
  await saveAiSettings(locationId,{...settings,provider,enabled:false})
  return NextResponse.json({ok:true,message:'OpenAI key connected. AI is still off. Review your OpenAI billing and app budget before enabling AI.'})
 }catch{return NextResponse.json({error:'Unable to connect OpenAI. No AI output was generated. Try again or follow the setup guide.'},{status:503})}
}
