const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { randomBytes, generateKeyPairSync, sign } = require('node:crypto')
const webhookKeys = generateKeyPairSync('ed25519')
const testPublicKey = webhookKeys.publicKey.export({
  type: 'spki',
  format: 'pem',
})
const fixture =
  'U2FsdGVkX1928I0KCQC8Xembd2JhlHg6Fj2D/obg8ptrav569sw9c1S4BzxHxQqMYIc1EGfoxsgo/2F56cY5BJnUEvjKbt5EA5KK8jvtf+LI3ggIjFjkbxcIf8wADtgVyV/IO3w6AE5KLYyl5VYaOQ=='
const servers = []
before(async () => {
  for (const [port, plan] of [
    [3813, 'free'],
    [3814, 'paid'],
    [3815, 'free'],
  ]) {
    const base = 'http://localhost:' + port
    const server = spawn(
      process.execPath,
      [
        '--require',
        './tests/fixtures/server.cjs',
        'node_modules/next/dist/bin/next',
        'start',
        '-p',
        String(port),
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1:1/fixture',
          GHL_API_BASE: 'https://fixture.highlevel.invalid',
          GHL_CLIENT_ID: 'fixture',
          GHL_CLIENT_SECRET: 'fixture',
          GHL_APP_ID: 'fixture-app',
          SESSION_SECRET: randomBytes(32).toString('hex'),
          GHL_APP_SHARED_SECRET: 'test-shared-secret',
          APP_BASE_URL: base,
          FIXTURE_PLAN: plan,
          FIXTURE_INCLUDED_PLAN: port === 3815 ? 'paid' : '',
          FIXTURE_WEBHOOK_PUBLIC_KEY: testPublicKey,
        },
        stdio: 'ignore',
      },
    )
    servers.push(server)
    let ready = false
    for (let n = 0; n < 100; n++) {
      try {
        await fetch(base)
        ready = true
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    if (!ready) throw new Error('Isolated server did not start')
  }
})
after(() => servers.forEach((server) => server.kill()))
async function login(port) {
  const base = 'http://localhost:' + port
  const response = await fetch(base + '/api/auth/session', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedData: fixture }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).locationId, 'tenant-a')
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /Secure/i)
  assert.match(cookie, /Partitioned/i)
  return cookie.split(';')[0]
}
test('isolated encrypted sign-in opens ticket screen without real CRM access', async () => {
  const cookie = await login(3813)
  const page = await fetch(
    'http://localhost:3813/settings/tickets?locationId=tenant-a',
    { headers: { Cookie: cookie } },
  )
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Isolated support ticket/)
})
test('isolated free account cannot unlock paid department features', async () => {
  const base = 'http://localhost:3813',
    cookie = await login(3813)
  const result = await fetch(base + '/api/departments', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId: 'tenant-a',
      name: 'Fixture department',
      pipelineId: 'fixture-pipeline',
    }),
  })
  assert.equal(result.status, 402)
  const report = await fetch(base + '/settings/reports?locationId=tenant-a', {
    headers: { Cookie: cookie },
  })
  assert.match(await report.text(), /available on Pro and Enterprise/)
})
test('isolated paid account can configure departments and load reports', async () => {
  const base = 'http://localhost:3814',
    cookie = await login(3814)
  const result = await fetch(base + '/api/departments', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId: 'tenant-a',
      name: 'Fixture department',
      pipelineId: 'fixture-pipeline',
    }),
  })
  assert.equal(result.status, 200)
  assert.equal((await result.json()).ok, true)
  const report = await fetch(base + '/settings/reports?locationId=tenant-a', {
    headers: { Cookie: cookie },
  })
  assert.equal(report.status, 200)
  assert.match(await report.text(), /Ticket volume/)
})

async function signedEvent(event) {
  const raw = JSON.stringify(event)
  return fetch('http://localhost:3813/api/webhooks/ghl', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ghl-signature': sign(
        null,
        Buffer.from(raw),
        webhookKeys.privateKey,
      ).toString('base64'),
    },
    body: raw,
  })
}
test('simulated signed billing upgrades and downgrades without any payment or live CRM access', async () => {
  const cookie = await login(3813)
  const upgrade = {
    type: 'PLAN_CHANGE',
    appId: 'fixture-app',
    locationId: 'tenant-a',
    newPlanId: '6a5ef2612c2a60b52316bb9d',
    webhookId: 'fixture-upgrade',
  }
  const first = await signedEvent(upgrade)
  assert.equal(first.status, 200)
  const paid = await fetch(
    'http://localhost:3813/settings/reports?locationId=tenant-a',
    { headers: { Cookie: cookie } },
  )
  assert.match(await paid.text(), /Ticket volume/)
  const duplicate = await signedEvent(upgrade)
  assert.equal((await duplicate.json()).duplicate, true)
  const downgrade = await signedEvent({
    ...upgrade,
    newPlanId: '6a5ef1c21222eb1abffd8bf5',
    webhookId: 'fixture-downgrade',
  })
  assert.equal(downgrade.status, 200)
  const replay = await signedEvent(upgrade)
  assert.equal((await replay.json()).duplicate, true)
  const free = await fetch(
    'http://localhost:3813/settings/reports?locationId=tenant-a',
    { headers: { Cookie: cookie } },
  )
  assert.match(await free.text(), /available on Pro and Enterprise/)
})
test('simulated signed billing rejects other apps and unknown plans', async () => {
  assert.equal(
    (
      await signedEvent({
        type: 'PLAN_CHANGE',
        appId: 'other-app',
        locationId: 'tenant-a',
        newPlanId: '6a5ef2612c2a60b52316bb9d',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await signedEvent({
        type: 'PLAN_CHANGE',
        appId: 'fixture-app',
        locationId: 'tenant-a',
        newPlanId: 'unknown-plan',
      })
    ).status,
    422,
  )
})

test('included service access keeps paid features without a paid Marketplace subscription', async () => {
  const base = 'http://localhost:3815',
    cookie = await login(3815)
  const result = await fetch(base + '/api/departments', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId: 'tenant-a',
      name: 'Included service department',
      pipelineId: 'fixture-pipeline',
    }),
  })
  assert.equal(result.status, 200)
  const report = await fetch(base + '/settings/reports?locationId=tenant-a', {
    headers: { Cookie: cookie },
  })
  assert.match(await report.text(), /Ticket volume/)
  const raw = JSON.stringify({
    type: 'PLAN_CHANGE',
    appId: 'fixture-app',
    locationId: 'tenant-a',
    newPlanId: '6a5ef1c21222eb1abffd8bf5',
    webhookId: 'fixture-included-free-plan',
  })
  const change = await fetch(base + '/api/webhooks/ghl', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ghl-signature': sign(
        null,
        Buffer.from(raw),
        webhookKeys.privateKey,
      ).toString('base64'),
    },
    body: raw,
  })
  assert.equal(change.status, 200)
  const after = await fetch(base + '/settings/reports?locationId=tenant-a', {
    headers: { Cookie: cookie },
  })
  assert.match(await after.text(), /Ticket volume/)
})
