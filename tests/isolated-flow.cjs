const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const {
  randomBytes,
  generateKeyPairSync,
  sign,
  createHmac,
} = require('node:crypto')
const webhookKeys = generateKeyPairSync('ed25519')
const testPublicKey = webhookKeys.publicKey.export({
  type: 'spki',
  format: 'pem',
})
const fixture =
  'U2FsdGVkX1928I0KCQC8Xembd2JhlHg6Fj2D/obg8ptrav569sw9c1S4BzxHxQqMYIc1EGfoxsgo/2F56cY5BJnUEvjKbt5EA5KK8jvtf+LI3ggIjFjkbxcIf8wADtgVyV/IO3w6AE5KLYyl5VYaOQ=='
const servers = []
const secrets = new Map()
before(async () => {
  for (const [port, plan] of [
    [3813, 'free'],
    [3814, 'paid'],
    [3815, 'free'],
  ]) {
    const base = 'http://localhost:' + port
    const secret = randomBytes(32).toString('hex')
    secrets.set(port, secret)
    let serverError = ''
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
          SESSION_SECRET: secret,
          GHL_APP_SHARED_SECRET: 'test-shared-secret',
          APP_BASE_URL: base,
          FIXTURE_PLAN: plan,
          FIXTURE_INCLUDED_PLAN: port === 3815 ? 'paid' : '',
          FIXTURE_WEBHOOK_PUBLIC_KEY: testPublicKey,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    server.stderr.on('data', (chunk) => {
      serverError = (serverError + chunk.toString()).slice(-5000)
    })
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
    if (!ready) throw new Error('Isolated server did not start: ' + serverError)
  }
})
function teamCookie(port) {
  const encoded = Buffer.from(
    JSON.stringify({
      locationId: 'tenant-a',
      userId: 'test-user',
      role: 'user',
      exp: Date.now() + 60000,
    }),
  ).toString('base64url')
  return (
    'tmez_session=' +
    encoded +
    '.' +
    createHmac('sha256', secrets.get(port)).update(encoded).digest('base64url')
  )
}

test('projects, tasks, timers and billable rates persist with administrator-only rate visibility', async () => {
  const base = 'http://localhost:3814',
    cookie = await login(3814)
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
  }
  const post = (action, data, id, customHeaders = headers) =>
    fetch(base + '/api/workspace', {
      method: 'POST',
      headers: customHeaders,
      body: JSON.stringify({ locationId: 'tenant-a', action, data, id }),
    })
  const project = {
    title: 'Fixture project',
    description: 'Isolated project',
    status: 'active',
    hourlyRate: 1000,
    currency: 'ZAR',
    members: ['test-user'],
    userRates: [{ userId: 'test-user', hourlyRate: 1200, currency: 'ZAR' }],
  }
  const create = await post('project', project)
  assert.equal(create.status, 200)
  const id = (await create.json()).id
  const task = await post('task', {
    title: 'Fixture task',
    projectId: id,
    status: 'todo',
    assignedTo: 'test-user',
    ticketId: 'fixture-ticket',
  })
  assert.equal(task.status, 200)
  assert.equal(
    (
      await post('task', {
        title: 'Wrong project',
        projectId: 'another-tenant-project',
        status: 'todo',
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await post('task', {
        title: 'Wrong ticket',
        projectId: id,
        status: 'todo',
        ticketId: 'foreign-ticket',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await post('manual-time', {
        projectId: id,
        description: 'Fixture billable hour',
        minutes: 60,
        billable: true,
      })
    ).status,
    200,
  )
  let state = await (
    await fetch(base + '/api/workspace?locationId=tenant-a', { headers })
  ).json()
  assert.equal(
    state.time.find((t) => t.description === 'Fixture billable hour').rateMinor,
    120000,
  )
  assert.equal(
    (await post('project', { ...project, hourlyRate: 2000, userRates: [] }, id))
      .status,
    200,
  )
  state = await (
    await fetch(base + '/api/workspace?locationId=tenant-a', { headers })
  ).json()
  assert.equal(
    state.time.find((t) => t.description === 'Fixture billable hour').rateMinor,
    120000,
    'rate snapshots do not change retroactively',
  )
  const timer = {
    projectId: id,
    description: 'Fixture running timer',
    billable: false,
  }
  assert.equal((await post('timer-start', timer)).status, 200)
  assert.equal(
    (await post('timer-start', timer)).status,
    409,
    'one active timer per person',
  )
  assert.equal((await post('timer-stop', {})).status, 200)
  state = await (
    await fetch(base + '/api/workspace?locationId=tenant-a', { headers })
  ).json()
  assert.equal(
    state.time.find((t) => t.description === 'Fixture running timer').minutes,
    1,
  )
  const userHeaders = { ...headers, Cookie: teamCookie(3814) }
  const user = await (
    await fetch(base + '/api/workspace?locationId=tenant-a', {
      headers: userHeaders,
    })
  ).json()
  assert.equal(user.admin, false)
  assert.ok(
    user.projects.every(
      (p) => p.data.hourlyRate === undefined && p.data.userRates === undefined,
    ),
  )
  assert.ok(user.time.every((t) => t.rateMinor === null))
  assert.equal(
    (await post('project', project, undefined, userHeaders)).status,
    403,
  )
  assert.equal(
    (
      await post(
        'article',
        { title: 'Forbidden', body: 'Not an admin', published: true },
        undefined,
        userHeaders,
      )
    ).status,
    403,
  )
  const privateProject = await post('project', {
    title: 'Restricted private project',
    description: 'Private project details',
    status: 'active',
    visibility: 'members',
    members: [],
  })
  assert.equal(privateProject.status, 200)
  const privateId = (await privateProject.json()).id
  const privateTask = await post('task', {
    title: 'Private task',
    projectId: privateId,
    status: 'todo',
  })
  assert.equal(privateTask.status, 200)
  const privateTaskId = (await privateTask.json()).id
  const restricted = await (
    await fetch(base + '/api/workspace?locationId=tenant-a', {
      headers: userHeaders,
    })
  ).json()
  assert.ok(!restricted.projects.some((p) => p.id === privateId))
  assert.ok(!restricted.tasks.some((t) => t.id === privateTaskId))
  assert.equal(
    (
      await post(
        'task',
        {
          title: 'Attempt to move private task',
          projectId: id,
          status: 'todo',
        },
        privateTaskId,
        userHeaders,
      )
    ).status,
    403,
  )
  assert.equal(
    (
      await post(
        'timer-start',
        {
          projectId: privateId,
          description: 'Forbidden work',
          billable: false,
        },
        undefined,
        userHeaders,
      )
    ).status,
    400,
  )
})

test('customer portal is one-use, ticket-scoped, excludes internal records and revokes active sessions', async () => {
  const base = 'http://localhost:3814',
    cookie = await login(3814)
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
  }
  for (const published of [true, false]) {
    const create = await fetch(base + '/api/workspace', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: 'tenant-a',
        action: 'article',
        data: {
          title: published ? 'Published fixture answer' : 'DRAFT SECRET',
          body: published
            ? 'Reset your password using the reset link.'
            : 'Never disclose this draft.',
          published,
        },
      }),
    })
    assert.equal(create.status, 200)
  }
  const grant = await fetch(base + '/api/tickets/fixture-ticket/portal', {
    method: 'POST',
    headers,
    body: JSON.stringify({ locationId: 'tenant-a' }),
  })
  assert.equal(grant.status, 200)
  const { url, id } = await grant.json(),
    token = new URL(url).hash.slice(1)
  const portalLogin = () =>
    fetch(base + '/api/portal', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign-in', token }),
    })
  const first = await portalLogin()
  assert.equal(first.status, 200)
  const portalCookie = first.headers.get('set-cookie').split(';')[0]
  assert.equal(
    (await portalLogin()).status,
    401,
    'one-use invite cannot be replayed',
  )
  const customerHeaders = {
    Cookie: portalCookie,
    Origin: base,
    'Content-Type': 'application/json',
  }
  const message = await fetch(base + '/api/portal', {
    method: 'POST',
    headers: customerHeaders,
    body: JSON.stringify({ action: 'reply', body: 'Customer fixture message' }),
  })
  assert.equal(message.status, 200)
  const read = await fetch(base + '/api/portal', { headers: customerHeaders })
  assert.equal(read.status, 200)
  const text = await read.text(),
    data = JSON.parse(text)
  assert.equal(data.ticket.id, 'fixture-ticket')
  assert.ok(data.messages.some((m) => m.body === 'Customer fixture message'))
  assert.ok(data.articles.some((a) => a.title === 'Published fixture answer'))
  assert.doesNotMatch(
    text,
    /DRAFT SECRET|Never disclose|Internal fixture note|fixture\.txt|accessToken|hourlyRate|actorId/,
  )
  assert.equal(
    (
      await fetch(base + '/api/portal', {
        method: 'POST',
        headers: { ...customerHeaders, Origin: 'https://attacker.invalid' },
        body: JSON.stringify({ action: 'reply', body: 'forbidden' }),
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(base + '/api/tickets/fixture-ticket/portal', {
        method: 'POST',
        headers: { ...headers, Cookie: teamCookie(3814) },
        body: JSON.stringify({ locationId: 'tenant-a' }),
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(base + '/api/tickets/fixture-ticket/portal', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locationId: 'tenant-a', revokeId: id }),
      })
    ).status,
    200,
  )
  assert.equal(
    (await fetch(base + '/api/portal', { headers: customerHeaders })).status,
    401,
    'revocation immediately invalidates an active customer session',
  )
})

test('AI is disabled without an explicit provider setup and never silently spends money', async () => {
  const base = 'http://localhost:3814',
    cookie = await login(3814)
  const result = await fetch(base + '/api/workspace/assist', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId: 'tenant-a',
      question: 'How do I reset my password?',
      consent: true,
    }),
  })
  assert.equal(result.status, 503)
  assert.match((await result.json()).error, /AI drafts are off/)
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
  }
  const settings = {
    enabled: false,
    provider: 'openai',
    bracket: '50-100',
    monthlyLimitUsd: 75,
  }
  const configure = (value) =>
    fetch(base + '/api/workspace', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: 'tenant-a',
        action: 'ai-settings',
        data: value,
      }),
    })
  assert.equal((await configure(settings)).status, 200)
  const read = await (
    await fetch(base + '/api/workspace?locationId=tenant-a', { headers })
  ).json()
  assert.equal(read.ai.settings.enabled, false)
  assert.equal(read.ai.settings.monthlyLimitUsd, 75)
  assert.deepEqual(
    read.ai.providers.map((p) => p.provider),
    ['openai', 'anthropic', 'gemini'],
  )
  assert.equal(
    (await configure({ ...settings, monthlyLimitUsd: 101 })).status,
    400,
  )
  assert.equal(
    (await configure({ ...settings, enabled: true })).status,
    409,
    'missing provider setup cannot be bypassed by the switch',
  )
  const user = await fetch(base + '/api/workspace', {
    method: 'POST',
    headers: { ...headers, Cookie: teamCookie(3814) },
    body: JSON.stringify({
      locationId: 'tenant-a',
      action: 'ai-settings',
      data: settings,
    }),
  })
  assert.equal(user.status, 403)
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

test('ticket workspace persists internal notes and response measurements in isolated Postgres', async () => {
  const base = 'http://localhost:3814',
    cookie = await login(3814)
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
  }
  const url = base + '/api/tickets/fixture-ticket/workspace'
  const get = async () => {
    const r = await fetch(url + '?locationId=tenant-a', { headers })
    assert.equal(r.status, 200)
    return r.json()
  }
  assert.equal((await get()).ticket.subject, 'Isolated support ticket')
  const note = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      locationId: 'tenant-a',
      action: 'note',
      body: 'Internal fixture note',
    }),
  })
  assert.equal(note.status, 200)
  let data = await get()
  assert.ok(data.activity.some((a) => a.body === 'Internal fixture note'))
  assert.equal(
    data.details.firstResponseAt,
    undefined,
    'internal notes never count as customer replies',
  )
  const respond = () =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: 'tenant-a',
        action: 'first-response',
      }),
    })
  assert.equal((await respond()).status, 200)
  const first = (await get()).details.firstResponseAt
  assert.ok(Date.parse(first) > 0)
  assert.equal((await respond()).status, 200)
  assert.equal(
    (await get()).details.firstResponseAt,
    first,
    'first response timestamp is immutable',
  )
  const dueAt = '2026-12-01T08:00:00.000Z'
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          locationId: 'tenant-a',
          action: 'due-date',
          dueAt,
        }),
      })
    ).status,
    200,
  )
  assert.equal((await get()).details.dueAt, dueAt)
  const file = await fetch(base + '/api/tickets/fixture-ticket/files', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      locationId: 'tenant-a',
      name: 'fixture.txt',
      mime: 'text/plain',
      content: Buffer.from('private fixture file').toString('base64'),
    }),
  })
  assert.equal(file.status, 200)
  const id = (await get()).files[0].id
  const download = await fetch(
    base + `/api/tickets/fixture-ticket/files?locationId=tenant-a&fileId=${id}`,
    { headers },
  )
  assert.equal(download.status, 200)
  assert.equal(await download.text(), 'private fixture file')
  assert.match(download.headers.get('content-disposition'), /attachment/)
  assert.match(download.headers.get('cache-control'), /no-store/)
  const patch = await fetch(base + '/api/tickets/fixture-ticket', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      locationId: 'tenant-a',
      assignedTo: 'test-user',
      priority: 'High',
      stageId: 'stage-resolved',
      status: 'won',
    }),
  })
  assert.equal(patch.status, 200)
  data = await get()
  assert.equal(data.ticket.priority, 'High')
  assert.equal(data.ticket.assignedUserId, 'test-user')
  assert.equal(data.ticket.stageName, 'Resolved')
  assert.ok(data.details.resolvedAt)
})

test('workspace, files and assignments reject other accounts and non-support opportunities', async () => {
  const base = 'http://localhost:3814',
    cookie = await login(3814)
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
  }
  for (const id of ['foreign-ticket', 'sales-ticket']) {
    assert.equal(
      (
        await fetch(base + `/api/tickets/${id}/workspace?locationId=tenant-a`, {
          headers,
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await fetch(base + `/api/tickets/${id}/workspace`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            locationId: 'tenant-a',
            action: 'note',
            body: 'must not save',
          }),
        })
      ).status,
      403,
    )
  }
  assert.equal(
    (
      await fetch(base + '/api/tickets/fixture-ticket', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          locationId: 'tenant-a',
          assignedTo: 'outside-user',
        }),
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await fetch(
        base +
          '/api/tickets/fixture-ticket/files?locationId=tenant-b&fileId=anything',
        { headers },
      )
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(
        base + '/api/tickets/fixture-ticket/workspace?locationId=tenant-a',
      )
    ).status,
    401,
  )
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
