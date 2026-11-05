// Loaded only by isolated HTTP tests. No database or provider traffic leaves this process.
const pg = require('pg')
const install = {locationId:'tenant-a',companyId:'test-company',userId:'test-user',accessToken:'fixture-token',refreshToken:'fixture-refresh',expiresAt:Date.now()+3600000,plan:process.env.FIXTURE_PLAN || 'free',installedAt:Date.now(),pipelineId:'fixture-pipeline'}
pg.Pool = class {
 async query(sql,args=[]) {
  if(sql.includes('CREATE TABLE')) return {rows:[],rowCount:0}
  if(sql.includes('SELECT data FROM tmez_installs')) return {rows:args[0]==='tenant-a'?[{data:structuredClone(install)}]:[]}
  if(sql.startsWith('UPDATE tmez_installs')) {Object.assign(install,JSON.parse(args[1]));return {rows:[{data:structuredClone(install)}],rowCount:1}}
  throw new Error('Unexpected isolated database operation')
 }
}
const stages=[{id:'stage-new',name:'New',position:0},{id:'stage-resolved',name:'Resolved',position:1}]
const ticket={id:'fixture-ticket',name:'Isolated support ticket',locationId:'tenant-a',pipelineId:'fixture-pipeline',pipelineStageId:'stage-new',createdAt:new Date(Date.now()-60000).toISOString(),updatedAt:new Date().toISOString()}
const originalFetch=global.fetch
global.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'?input:input.url || input.toString())
 if(['localhost','127.0.0.1'].includes(url.hostname)) return originalFetch(input,options)
 if(url.hostname!=='fixture.highlevel.invalid') throw new Error('External traffic blocked in isolated test')
 let body
 if(url.pathname==='/opportunities/pipelines') body={pipelines:[{id:'fixture-pipeline',name:'Isolated Support',stages}]}
 else if(url.pathname==='/opportunities/search') body={opportunities:[ticket]}
 else if(url.pathname==='/users/') body={users:[{id:'test-user',name:'Isolated test user',isActive:true}]}
 else if(url.pathname==='/opportunities/fixture-ticket') body={opportunity:ticket}
 else throw new Error('Unexpected isolated provider operation: '+url.pathname)
 return Response.json(body)
}
