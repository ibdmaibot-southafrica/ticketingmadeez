// Local-only browser harness. Both app credentials and all CRM records are synthetic.
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const http = require('node:http')
const APP_PORT=61000+(process.pid%1000)*2,PREVIEW_PORT=APP_PORT+1
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
    String(APP_PORT),
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
      APP_BASE_URL: 'http://127.0.0.1:'+APP_PORT,
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
        port: APP_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: '127.0.0.1:'+APP_PORT,
          ...(req.headers.origin ? { origin: 'http://127.0.0.1:'+APP_PORT } : {}),
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
    `<!doctype html><html><head><title>TicketingMadeEZ isolated preview</title></head><body><h1>Isolated browser preview</h1><p>Synthetic account and records. No client access or payments.</p><button id="open">Open synthetic workspace</button><p id="status">SSO requests: 0</p><iframe id="fixture-workspace" title="Synthetic CRM app" style="display:none;width:100%;height:85vh;border:0"></iframe><script>let requests=0;const frame=document.getElementById('fixture-workspace');window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.message==='REQUEST_USER_DATA'){document.getElementById('status').textContent='SSO requests: '+(++requests);event.source.postMessage({message:'REQUEST_USER_DATA_RESPONSE',payload:${JSON.stringify(fixture)}},location.origin)}});document.getElementById('open').onclick=()=>{frame.style.display='block';frame.src='/settings/tickets?locationId=tenant-a'}</script></body></html>`,
  )
})
server.listen(PREVIEW_PORT, '127.0.0.1', () =>
  process.stdout.write('Isolated browser preview: http://localhost:'+PREVIEW_PORT+'\n'),
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
