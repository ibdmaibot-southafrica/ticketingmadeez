const crypto = require('node:crypto')
const { syncBuiltinESMExports } = require('node:module')
if (process.env.FIXTURE_WEBHOOK_PUBLIC_KEY) {
  const verify = crypto.verify
  crypto.verify = (algorithm, data, key, signature) =>
    verify(algorithm, data, process.env.FIXTURE_WEBHOOK_PUBLIC_KEY, signature)
  syncBuiltinESMExports()
}
const receipts = new Map()
// Loaded only by isolated HTTP tests. No database or provider traffic leaves this process.
const pg = require('pg')
const { PGlite } = require('@electric-sql/pglite')
let workspaceDb
async function workspaceQuery(sql, args = []) {
  workspaceDb ||= new PGlite()
  if (sql.includes('CREATE TABLE')) {
    await workspaceDb.exec(sql)
    return { rows: [], rowCount: 0 }
  }
  const result = await workspaceDb.query(sql, args)
  return { ...result, rowCount: result.affectedRows || result.rows.length }
}
const install = {
  locationId: 'tenant-a',
  companyId: 'test-company',
  userId: 'test-user',
  accessToken: 'fixture-token',
  refreshToken: 'fixture-refresh',
  expiresAt: Date.now() + 3600000,
  plan: process.env.FIXTURE_PLAN || 'free',
  installedAt: Date.now(),
  pipelineId: 'fixture-pipeline',
  customFieldIds: { priority: 'fixture-priority' },
}
pg.Pool = class {
  async connect() {
    return { query: workspaceQuery, release() {} }
  }
  async query(sql, args = []) {
    if (
      sql.includes('tmez_ticket_') ||
      sql.includes('tmez_hub_') ||
      sql.includes('tmez_time_') ||
      sql.includes('tmez_portal_') ||
      sql.includes('tmez_ai_')
    )
      return workspaceQuery(sql, args)
    if (sql.includes('CREATE TABLE')) return { rows: [], rowCount: 0 }
    if (sql.includes('INSERT INTO tmez_webhook_receipts')) {
      if (receipts.has(args[0])) return { rows: [], rowCount: 0 }
      receipts.set(args[0], false)
      return { rows: [{ id: args[0] }], rowCount: 1 }
    }
    if (sql.includes('SELECT completed FROM tmez_webhook_receipts'))
      return { rows: [{ completed: receipts.get(args[0]) }] }
    if (sql.includes('UPDATE tmez_webhook_receipts')) {
      receipts.set(args[0], true)
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('DELETE FROM tmez_webhook_receipts')) {
      receipts.delete(args[0])
      return { rows: [], rowCount: 1 }
    }
    if (
      sql.includes('SELECT data FROM tmez_installs') ||
      sql.includes('SELECT i.data')
    )
      return {
        rows:
          args[0] === 'tenant-a'
            ? [
                {
                  data: structuredClone(install),
                  service_plan: process.env.FIXTURE_INCLUDED_PLAN,
                },
              ]
            : [],
      }
    if (sql.startsWith('UPDATE tmez_installs')) {
      Object.assign(install, JSON.parse(args[1]))
      return {
        rows: [
          {
            data: structuredClone(install),
            service_plan: process.env.FIXTURE_INCLUDED_PLAN,
          },
        ],
        rowCount: 1,
      }
    }
    throw new Error('Unexpected isolated database operation')
  }
}
const stages = [
  { id: 'stage-new', name: 'New', position: 0 },
  { id: 'stage-resolved', name: 'Resolved', position: 1 },
]
const ticket = {
  id: 'fixture-ticket',
  name: 'Isolated support ticket',
  locationId: 'tenant-a',
  pipelineId: 'fixture-pipeline',
  pipelineStageId: 'stage-new',
  createdAt: new Date(Date.now() - 60000).toISOString(),
  updatedAt: new Date().toISOString(),
}
const originalFetch = global.fetch
global.fetch = async (input, options) => {
  const url = new URL(
    typeof input === 'string' ? input : input.url || input.toString(),
  )
  if (['localhost', '127.0.0.1'].includes(url.hostname))
    return originalFetch(input, options)
  if (url.hostname === 'api.openai.com' && options?.headers?.Authorization === 'Bearer sk-fixture-customer-key-not-a-real-credential') {
    if (url.pathname.startsWith('/v1/models/')) return Response.json({ id:'gpt-5.4-mini-2026-03-17' })
    if (url.pathname === '/v1/responses') return Response.json({ output:[{type:'message',content:[{type:'output_text',text:'Synthetic customer-owned draft'}]}],usage:{input_tokens:100,output_tokens:20} })
  }
  if (url.hostname !== 'fixture.highlevel.invalid')
    throw new Error('External traffic blocked in isolated test')
  let body
  if (url.pathname === '/opportunities/pipelines')
    body = {
      pipelines: [{ id: 'fixture-pipeline', name: 'Isolated Support', stages }],
    }
  else if (url.pathname === '/opportunities/search')
    body = { opportunities: [ticket] }
  else if (url.pathname === '/users/')
    body = {
      users: [{ id: 'test-user', name: 'Isolated test user', isActive: true }],
    }
  else if (url.pathname === '/opportunities/fixture-ticket') {
    if (options?.method === 'PUT') {
      const patch = JSON.parse(options.body)
      if (patch.assignedTo === 'outside-user')
        throw new Error('Invalid assignment reached provider')
      if (patch.customFields)
        patch.customFields = patch.customFields.map((f) => ({
          id: f.id,
          fieldValue: f.field_value,
        }))
      Object.assign(ticket, patch)
    }
    body = { opportunity: ticket }
  } else if (url.pathname === '/opportunities/foreign-ticket')
    body = {
      opportunity: { ...ticket, id: 'foreign-ticket', locationId: 'tenant-b' },
    }
  else if (url.pathname === '/opportunities/sales-ticket')
    body = {
      opportunity: {
        ...ticket,
        id: 'sales-ticket',
        pipelineId: 'sales-pipeline',
      },
    }
  else
    throw new Error('Unexpected isolated provider operation: ' + url.pathname)
  return Response.json(body)
}
