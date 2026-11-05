// Local-only browser harness. Both app credentials and all CRM records are synthetic.
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const http = require('node:http')
const fixture =
  'U2FsdGVkX1928I0KCQC8Xembd2JhlHg6Fj2D/obg8ptrav569sw9c1S4BzxHxQqMYIc1EGfoxsgo/2F56cY5BJnUEvjKbt5EA5KK8jvtf+LI3ggIjFjkbxcIf8wADtgVyV/IO3w6AE5KLYyl5VYaOQ=='
const app = spawn(
  process.execPath,
  [
    '--require',
    './tests/fixtures/server.cjs',
    'node_modules/next/dist/bin/next',
    'start',
    '-H',
    '127.0.0.1',
    '-p',
    '3820',
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
      APP_BASE_URL: 'http://localhost:3820',
      FIXTURE_PLAN: 'paid',
      FIXTURE_TICKET_DELAY_MS: '18000',
      TMEZ_AI_API_KEY: '',
      TMEZ_AI_MODEL: '',
      TMEZ_AI_DAILY_LIMIT: '0',
    },
    stdio: 'inherit',
  },
)
const server = http.createServer((req, res) => {
  if (req.url !== '/') {
    const proxy = http.request(
      {
        hostname: '127.0.0.1',
        port: 3820,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: 'localhost:3820',
          ...(req.headers.origin ? { origin: 'http://localhost:3820' } : {}),
        },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers)
        upstream.pipe(res)
      },
    )
    proxy.on('error', () => {
      res.writeHead(503)
      res.end('Preview app is starting')
    })
    req.pipe(proxy)
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-store',
  })
  res.end(
    `<!doctype html><html><head><title>TicketingMadeEZ isolated preview</title></head><body><h1>Isolated browser preview</h1><p>Synthetic account and records. No client access or payments.</p><button id="open">Open synthetic workspace</button><p id="status"></p><script>document.getElementById('open').onclick=async()=>{const r=await fetch('/api/auth/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({encryptedData:${JSON.stringify(fixture)}})});if(r.ok)location.href='/settings/tickets?locationId=tenant-a';else document.getElementById('status').textContent='Synthetic sign-in failed'}</script></body></html>`,
  )
})
server.listen(3821, '127.0.0.1', () =>
  process.stdout.write('Isolated browser preview: http://localhost:3821\n'),
)
process.on('SIGINT', () => {
  server.close()
  app.kill()
  process.exit()
})
process.on('SIGTERM', () => {
  server.close()
  app.kill()
  process.exit()
})
