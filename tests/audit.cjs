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
