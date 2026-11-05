const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const crypto = require('node:crypto')
const source = ts.transpileModule(fs.readFileSync('lib/security.ts', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const loaded = new Module(
  require('node:path').resolve('lib/security.ts'),
  module,
)
loaded.paths = module.paths
loaded._compile(source, 'security.cjs')
const {
  signSession,
  readSession,
  planFromPayload,
  verifyWebhook,
  decryptContext,
} = loaded.exports
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex')
test('session requires valid signature and expiry', () => {
  const session = {
    locationId: 'tenant-a',
    userId: 'user-a',
    role: 'admin',
    exp: Date.now() + 60000,
  }
  const token = signSession(session)
  assert.deepEqual(readSession(token), session)
  assert.equal(readSession(token + 'x'), null)
  const [data, sig] = token.split('.')
  const other = Buffer.from(
    JSON.stringify({ ...session, locationId: 'tenant-b' }),
  ).toString('base64url')
  assert.equal(readSession(other + '.' + sig), null)
  assert.equal(
    readSession(signSession({ ...session, exp: Date.now() - 1 })),
    null,
  )
  assert.equal(readSession(), null)
})
test('billing maps exact live plan IDs and never grants unknown plans', () => {
  assert.equal(planFromPayload({ planId: '6a5ef2612c2a60b52316bb9d' }), 'paid')
  assert.equal(
    planFromPayload({ planId: '6a5f7ea52c2a60124d3ef51a' }),
    'enterprise',
  )
  assert.equal(planFromPayload({ planId: '6a5ef1c21222eb1abffd8bf5' }), 'free')
  assert.equal(planFromPayload({ planId: 'pro-fake' }), null)
  assert.equal(
    planFromPayload({
      planId: '6a5ef2612c2a60b52316bb9d',
      status: 'cancelled',
    }),
    'free',
  )
})
test('webhook rejects missing, forged and attacker-signed signatures', () => {
  assert.equal(verifyWebhook('{}', null), false)
  assert.equal(verifyWebhook('{}', 'N/A'), false)
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  assert.equal(
    verifyWebhook(
      '{}',
      crypto.sign(null, Buffer.from('{}'), privateKey).toString('base64'),
    ),
    false,
  )
})
test('SSO rejects malformed encrypted payloads', () => {
  assert.throws(() => decryptContext('invalid', 'secret'))
  assert.throws(() =>
    decryptContext(Buffer.from('Salted__bad').toString('base64'), 'secret'),
  )
})
