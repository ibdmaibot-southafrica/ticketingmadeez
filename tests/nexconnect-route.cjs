const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),{generateKeyPairSync,sign}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite')
function load(file,mocks){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,process:{env:{}},require:n=>n in mocks?mocks[n]:require(n)});return exports}
test('signed setup tickets are idempotent, ordered and isolated by account',async()=>{
 const db=new PGlite(),keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'})
 const pool={query:async(sql,args)=>{if(sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]}};return db.query(sql,args)}}
 const helpers=load('lib/nexconnect.ts',{'./kv':{getPool:()=>pool}})
 let isOwner=false
 const api=load('app/api/integrations/nexconnect/route.ts',{'@/lib/kv':{getPool:()=>pool,getInstall:async()=>({companyId:'companyAAAAAA'})},'@/lib/security':{COOKIE:'session',readSession:()=>({locationId:'locationAAAAA',role:'admin',agencyOwner:isOwner})},'@/lib/nexconnect':{...helpers,trustedNexConnectKey:async()=>publicKey}})
 const base={applicationId:'83b4f87e-80ce-487f-a09d-87e95c0d5ce8',locationId:'locationAAAAA',companyId:'companyAAAAAA',version:1,status:'draft',businessType:null,bundleSid:null,phoneNumber:null}
 const request=payload=>{const raw=typeof payload==='string'?payload:JSON.stringify(payload),time=String(Date.now()),signature=sign(null,Buffer.from('nexconnect-to-ticketingmadeez:v1:'+time+'.'+raw),keys.privateKey).toString('base64');return new Request('https://ticketing.example/api/integrations/nexconnect',{method:'POST',headers:{'x-nexconnect-time':time,'x-nexconnect-signature':signature},body:raw})}
 const first=await (await api.POST(request(base))).json(),again=await (await api.POST(request(base))).json()
 assert.equal(first.ticketId,again.ticketId);assert.match(first.ticketId,/^NC-/)
 await api.POST(request({...base,version:2,status:'under_review',businessType:'business'}));await api.POST(request(base))
 let stored=await db.query('SELECT data FROM tmez_nexconnect_tickets');assert.equal(stored.rows.length,1);assert.equal(stored.rows[0].data.status,'under_review')
 assert.equal((await api.POST(request({...base,version:3,locationId:'locationBBBBB',companyId:'companyBBBBBB'}))).status,409)
 await api.POST(request({...base,applicationId:'ccf4b257-24c3-49c5-9851-a78378175189',locationId:'locationBBBBB',companyId:'companyBBBBBB'}))
 const list=await (await api.GET({cookies:{get:()=>({value:'session'})}})).json();assert.equal(list.tickets.length,1);assert.equal(list.tickets[0].applicationId,base.applicationId)
 await api.POST(request({...base,applicationId:'9b976080-1f98-4bb9-8ff4-475539a62f8a',locationId:'locationBBBBB'}))
 isOwner=true
 const ownerList=await (await api.GET({cookies:{get:()=>({value:'session'})}})).json();assert.equal(ownerList.tickets.length,2)
 assert.equal((await api.POST(request({...base,identityDocument:'must-not-be-copied'}))).status,400)
 assert.equal((await api.POST(request('{bad json'))).status,400)
 await db.close()
})
