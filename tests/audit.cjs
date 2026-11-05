const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), Module = require('node:module'), path = require('node:path'), ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
function load(file, overrides) {
  const m = new Module(path.resolve(file), module)
  m.paths = module.paths
  const original = m.require.bind(m)
  m.require = name => name in overrides ? overrides[name] : original(name)
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file+'.cjs')
  return m.exports
}
test('CRM list failures cannot become empty boards, zero reports or empty user pools',async()=>{
  const failure = async()=>{throw new Error('synthetic provider outage')}
  const data=load('lib/ghl-data.ts',{'./ghl':{ghlJson:failure}})
  await assert.rejects(data.listOpportunities('a','p'),/outage/)
  await assert.rejects(data.listPipelines('a'),/outage/)
  await assert.rejects(data.getPipeline('a','p'),/outage/)
  const users=load('lib/users.ts',{'./ghl':{ghlJson:failure}})
  await assert.rejects(users.listActiveUsers('a'),/outage/)
  await assert.rejects(users.usersById('a'),/outage/)
})
test('ticket pagination reads every page, rejects repeated records and wrong account data',async()=>{
  const make=(id)=>({id,locationId:'a',pipelineId:'p'})
  const seen=[]
  const data=load('lib/ghl-data.ts',{'./ghl':{ghlJson:async url=>{
    const n=Number(new URL(url,'https://fixture.invalid').searchParams.get('page'));seen.push(n)
    return {opportunities:n===1?Array.from({length:100},(_,i)=>make('ticket-'+i)):[make('last')]}
  }}})
  assert.equal((await data.listOpportunities('a','p')).length,101)
  assert.deepEqual(seen,[1,2])
  const repeated=load('lib/ghl-data.ts',{'./ghl':{ghlJson:async()=>({opportunities:Array.from({length:100},(_,i)=>make('ticket-'+i))})}})
  await assert.rejects(repeated.listOpportunities('a','p'),/repeated/)
  const foreign=load('lib/ghl-data.ts',{'./ghl':{ghlJson:async()=>({opportunities:[{...make('wrong'),locationId:'b'}]})}})
  await assert.rejects(foreign.listOpportunities('a','p'),/does not match/)
})
test('provisioning never creates duplicate resources after a failed discovery request',async()=>{
  let mutations=0
  const provision=load('lib/provisioning.ts',{'./kv':{getInstall:async()=>({locationId:'a'})},'./ghl':{ghlJson:async(url,options)=>{
    if(options.method!=='GET') mutations++
    throw new Error('synthetic read outage')
  }}})
  await assert.rejects(provision.provisionLocation('a'),/outage/)
  assert.equal(mutations,0)
})
test('concurrent expired-token requests rotate once and preserve existing install settings',async()=>{
  const db=new PGlite()
  const originalFetch=global.fetch
  try {
    await db.exec('CREATE TABLE tmez_installs(location_id TEXT PRIMARY KEY,data JSONB NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW())')
    const original={locationId:'a',expiresAt:0,accessToken:'synthetic-old',refreshToken:'synthetic-refresh',plan:'paid',departments:[{id:'keep'}]}
    await db.query('INSERT INTO tmez_installs VALUES($1,$2,NOW())',['a',JSON.stringify(original)])
    let rotations=0
    global.fetch=async()=>{rotations++;await new Promise(r=>setTimeout(r,25));return Response.json({access_token:'synthetic-new',refresh_token:'synthetic-next',expires_in:3600})}
    const pool={connect:async()=>({query:(...args)=>db.query(...args),release(){}})}
    const ghl=load('lib/ghl.ts',{'./env':{env:{GHL_API_BASE:'https://fixture.invalid',GHL_CLIENT_ID:'fixture',GHL_CLIENT_SECRET:'fixture'}},'./kv':{getPool:()=>pool,getInstall:async()=> (await db.query('SELECT data FROM tmez_installs WHERE location_id=$1',['a'])).rows[0].data}})
    assert.deepEqual(await Promise.all(Array.from({length:8},()=>ghl.getValidToken('a'))),Array(8).fill('synthetic-new'))
    assert.equal(rotations,1)
    const stored=(await db.query('SELECT data FROM tmez_installs')).rows[0].data
    assert.deepEqual(stored.departments,original.departments)
    assert.equal(stored.plan,'paid')
    assert.equal(stored.refreshToken,'synthetic-next')
  } finally {global.fetch=originalFetch;await db.close()}
})
test('concurrent round-robin picks use an atomic persisted cursor',async()=>{
  const db=new PGlite()
  try {
    await db.exec('CREATE TABLE tmez_installs(location_id TEXT PRIMARY KEY,data JSONB NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW())')
    const install={plan:'paid',assignment:{enabled:true,strategy:'round-robin'}}
    await db.query('INSERT INTO tmez_installs VALUES($1,$2,NOW())',['a',JSON.stringify(install)])
    const assignment=load('lib/assignment.ts',{'@/lib/entitlements':{getFeaturePlan:x=>x.plan},'./kv':{getInstall:async()=>install,getPool:()=>({query:(...args)=>db.query(...args)})},'./ghl':{},'./users':{listActiveUsers:async()=>[{id:'one'},{id:'two'},{id:'three'}]}})
    const picks=await Promise.all(Array.from({length:12},()=>assignment.pickNextAssignee('a')))
    for(const id of ['one','two','three']) assert.equal(picks.filter(p=>p.id===id).length,4)
  } finally {await db.close()}
})
test('expired account requests reauthenticate once and preserve the original save payload',async()=>{
  const savedFetch=global.fetch,savedWindow=global.window
  const listeners=new Set(),requests=[]
  let renewals=0,authenticated=false
  const parent={postMessage(){queueMicrotask(()=>{for(const listener of [...listeners])listener({source:parent,data:{message:'REQUEST_USER_DATA_RESPONSE',payload:'synthetic-encrypted-context'}})})}}
  global.window={parent,location:{origin:'https://fixture.invalid',search:'?locationId=a'},addEventListener(type,fn){listeners.add(fn)},removeEventListener(type,fn){listeners.delete(fn)}}
  global.fetch=async(url,init)=>{
    if(url==='/api/auth/session'){renewals++;await new Promise(r=>setTimeout(r,20));authenticated=true;return Response.json({locationId:'a'})}
    requests.push({url,method:init.method,body:init.body})
    return Response.json(authenticated?{ok:true}:{error:'Authentication required'},{status:authenticated?200:401})
  }
  try {
    const {accountFetch}=load('lib/account-fetch.ts',{})
    const payload={method:'POST',body:JSON.stringify({locationId:'a',action:'note',body:'unsaved text'})}
    const results=await Promise.all([accountFetch('/api/workspace',payload),accountFetch('/api/workspace',payload)])
    assert.ok(results.every(r=>r.status===200));assert.equal(renewals,1);assert.equal(requests.length,4)
    assert.ok(requests.every(r=>r.body===payload.body&&r.method==='POST'));assert.equal(listeners.size,0)
  } finally {global.fetch=savedFetch;global.window=savedWindow}
})
test('authentication renewal rejects another account and never retries a network ambiguity',async()=>{
  const savedFetch=global.fetch,savedWindow=global.window
  const listeners=new Set();let saves=0
  const parent={postMessage(){queueMicrotask(()=>{for(const listener of [...listeners])listener({source:parent,data:{message:'REQUEST_USER_DATA_RESPONSE',payload:'synthetic-context'}})})}}
  global.window={parent,location:{origin:'https://fixture.invalid',search:'?locationId=a'},addEventListener(type,fn){listeners.add(fn)},removeEventListener(type,fn){listeners.delete(fn)}}
  global.fetch=async url=>{if(url==='/api/auth/session')return Response.json({locationId:'another-account'});saves++;return Response.json({error:'expired'},{status:401})}
  try {
    const {accountFetch}=load('lib/account-fetch.ts',{})
    assert.equal((await accountFetch('/api/workspace',{method:'POST',body:'original'})).status,401);assert.equal(saves,1)
    global.fetch=async()=>{saves++;throw new Error('synthetic disconnected response')}
    await assert.rejects(accountFetch('/api/workspace',{method:'POST',body:'original'}),/disconnected/)
    assert.equal(saves,2)
  } finally {global.fetch=savedFetch;global.window=savedWindow}
})
test('concurrent department edits preserve both records and cannot delete the last department',async()=>{
  const db=new PGlite();let queue=Promise.resolve()
  try {
    await db.exec('CREATE TABLE tmez_installs(location_id TEXT PRIMARY KEY,data JSONB NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW())')
    await db.query('INSERT INTO tmez_installs VALUES($1,$2,NOW())',['a',JSON.stringify({pipelineId:'p1'})])
    const pool={async connect(){const previous=queue;let release;queue=new Promise(r=>release=r);await previous;return {query:(...args)=>db.query(...args),release}}}
    const departments=load('lib/departments.ts',{'./kv':{getPool:()=>pool}})
    await Promise.all([departments.upsertDepartment('a',{id:'two',name:'Two',pipelineId:'p2'}),departments.upsertDepartment('a',{id:'three',name:'Three',pipelineId:'p3'})])
    let stored=(await db.query('SELECT data FROM tmez_installs')).rows[0].data
    assert.equal(stored.departments.length,3)
    await assert.rejects(departments.upsertDepartment('a',{id:'duplicate',name:'Duplicate',pipelineId:'p2'}),/unique/)
    await Promise.all([departments.patchDepartment('a','two',{sla:{active:true,firstResponseMinutes:15,resolutionMinutes:60}}),departments.patchDepartment('a','three',{name:'Updated three'})])
    stored=(await db.query('SELECT data FROM tmez_installs')).rows[0].data
    assert.equal(stored.departments.find(d=>d.id==='two').sla.firstResponseMinutes,15)
    assert.equal(stored.departments.find(d=>d.id==='three').name,'Updated three')
    await Promise.all([departments.removeDepartment('a','two'),departments.removeDepartment('a','three')])
    await assert.rejects(departments.removeDepartment('a','default'),/last department/)
    assert.equal((await db.query('SELECT data FROM tmez_installs')).rows[0].data.departments.length,1)
  } finally {await db.close()}
})
test('file quota is enforced under concurrent uploads and downloads remain account scoped',async()=>{
 const db=new PGlite();let queue=Promise.resolve()
 try {
  const query=async(sql,args=[])=>{if(sql.includes('CREATE TABLE')){await db.exec(sql);return {rows:[]}}return db.query(sql,args)}
  const pool={query,async connect(){const previous=queue;let release;queue=new Promise(r=>release=r);await previous;return {query,release}}}
  const files=load('lib/workspace-store.ts',{'./kv':{getPool:()=>pool}})
  const values={locationId:'a',ticketId:'t',actorId:'fixture',name:'fixture.txt',mime:'text/plain',content:Buffer.from('Synthetic quota test')}
  const ids=await Promise.all(Array.from({length:20},()=>files.storeTicketFile(values)))
  await assert.rejects(files.storeTicketFile(values),/20 files/)
  assert.equal((await files.readTicketWorkspace('a','t')).files.length,20)
  assert.equal(await files.readTicketFile('b','t',ids[0]),null)
  assert.equal(Buffer.from((await files.readTicketFile('a','t',ids[0])).content).toString(),'Synthetic quota test')
 } finally {await db.close()}
})
test('OAuth reinstall preserves configured plans, departments and assignment settings',async()=>{
 let stored={locationId:'fixture',plan:'paid',departments:[{id:'keep'}],assignment:{enabled:false},accessToken:'old',refreshToken:'old',expiresAt:1,installedAt:1}
 const ghl=load('lib/ghl.ts',{'./env':{env:{}},'./kv':{getInstall:async id=>id==='fixture'?stored:null,saveInstall:async value=>{stored=value}}})
 const result=await ghl.persistTokenResponse({locationId:'fixture',companyId:'company',userId:'owner',access_token:'synthetic-new',refresh_token:'synthetic-refresh',expires_in:3600})
 assert.deepEqual(result.locationIds,['fixture']);assert.deepEqual(result.freshLocationIds,[])
 assert.equal(stored.plan,'paid');assert.deepEqual(stored.departments,[{id:'keep'}]);assert.equal(stored.assignment.enabled,false);assert.equal(stored.installedAt,1)
 await assert.rejects(ghl.persistTokenResponse({access_token:'fixture'}),/neither locationId nor companyId/)
})
