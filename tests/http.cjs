const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomBytes, createHmac } = require('node:crypto')
const secret = randomBytes(32).toString('hex')
const port=39000+(process.pid%500)
const base = 'http://localhost:'+port
let server
before(async () => {
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(port)],
    {
      env: { ...process.env, SESSION_SECRET: secret, APP_BASE_URL: base },
      stdio: 'ignore',
    },
  )
  for (let n = 0; n < 100; n++) {
    try {
      await fetch(base)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('Server did not start')
})
after(() => {
  server?.kill()
})
function cookie(locationId = 'tenant-a', role = 'admin') {
  const data = Buffer.from(
    JSON.stringify({
      locationId,
      userId: 'test-user',
      role,
      exp: Date.now() + 60000,
    }),
  ).toString('base64url')
  return (
    'tmez_session=' +
    data +
    '.' +
    createHmac('sha256', secret).update(data).digest('base64url')
  )
}
test('anonymous writes and account pages require authentication', async () => {
  assert.equal(
    (
      await fetch(base + '/api/tickets/test', {
        method: 'PATCH',
        body: JSON.stringify({ locationId: 'tenant-a' }),
      })
    ).status,
    401,
  )
  const r = await fetch(base + '/settings?locationId=tenant-a', {
    redirect: 'manual',
  })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('location'), null)
  assert.match(r.headers.get('cache-control'), /no-store/)
  assert.match(await r.text(), /Verifying account access/)
})
test('signed session cannot cross tenant boundaries', async () => {
  const r = await fetch(base + '/api/tickets/test', {
    method: 'PATCH',
    headers: {
      Cookie: cookie(),
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ locationId: 'tenant-b', status: 'won' }),
  })
  assert.equal(r.status, 403)
  assert.equal(
    (
      await fetch(base + '/settings?locationId=tenant-b', {
        headers: { Cookie: cookie() },
      })
    ).status,
    403,
  )
})
test('non-admin cannot configure departments; cross-origin writes rejected', async () => {
  const r = await fetch(base + '/api/departments?locationId=tenant-a', {
    method: 'DELETE',
    headers: { Cookie: cookie('tenant-a', 'user'), Origin: base },
  })
  assert.equal(r.status, 403)
  const cross = await fetch(base + '/api/tickets/test', {
    method: 'PATCH',
    headers: {
      Cookie: cookie(),
      Origin: 'https://attacker.invalid',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ locationId: 'tenant-a' }),
  })
  assert.equal(cross.status, 403)
})
test('valid session reaches account route; forged webhook cannot reach billing', async () => {
  assert.equal(
    (
      await fetch(base + '/settings/nonexistent?locationId=tenant-a', {
        headers: { Cookie: cookie() },
        redirect: 'manual',
      })
    ).status,
    404,
  )
  const r = await fetch(base + '/api/webhooks/ghl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'PLAN_CHANGE',
      locationId: 'tenant-a',
      newPlanId: '6a5ef2612c2a60b52316bb9d',
    }),
  })
  assert.equal(r.status, 401)
})
