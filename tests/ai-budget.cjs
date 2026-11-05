const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  ts = require('typescript')
const db = new PGlite()
let queue = Promise.resolve()
async function query(sql, args = []) {
  if (sql.includes('CREATE TABLE')) {
    await db.exec(sql)
    return { rows: [], rowCount: 0 }
  }
  const r = await db.query(sql, args)
  return { ...r, rowCount: r.affectedRows || r.rows.length }
}
const pool = {
  query,
  async connect() {
    const previous = queue
    let release
    queue = new Promise((resolve) => {
      release = resolve
    })
    await previous
    return { query, release }
  },
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const m = new Module(path.resolve(file), module)
  m.paths = module.paths
  const original = m.require.bind(m)
  m.require = (name) =>
    name === './kv'
      ? { getPool: () => pool }
      : name === './hub-store'
        ? load('lib/hub-store.ts')
        : name === './ai-config'
          ? load('lib/ai-config.ts')
          : original(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    file + '.cjs',
  )
  cache.set(file, m.exports)
  return m.exports
}
const {
  getAiSettings,
  saveAiSettings,
  getAiBudget,
  reserveAiBudget,
  settleAiBudget,
} = load('lib/ai-budget.ts')
const { aiProviderConfig, aiCostMicros } = load('lib/ai-config.ts')
after(() => db.close())
test('AI starts off, settings are account-scoped and blank token prices never count as configured', async () => {
  assert.equal((await getAiSettings('fixture-a')).enabled, false)
  await saveAiSettings('fixture-a', {
    enabled: true,
    provider: 'openai',
    bracket: '10-50',
    monthlyLimitUsd: 10,
  })
  assert.equal((await getAiSettings('fixture-a')).enabled, true)
  assert.equal((await getAiSettings('fixture-b')).enabled, false)
  const original = {
    key: process.env.TMEZ_AI_API_KEY,
    model: process.env.TMEZ_AI_MODEL,
    input: process.env.TMEZ_AI_INPUT_USD_PER_MILLION,
    output: process.env.TMEZ_AI_OUTPUT_USD_PER_MILLION,
  }
  try {
    process.env.TMEZ_AI_API_KEY = 'fixture'
    process.env.TMEZ_AI_MODEL = 'fixture'
    process.env.TMEZ_AI_INPUT_USD_PER_MILLION = ''
    process.env.TMEZ_AI_OUTPUT_USD_PER_MILLION = ''
    assert.equal(aiProviderConfig('openai').configured, false)
  } finally {
    for (const [key, value] of Object.entries({
      TMEZ_AI_API_KEY: original.key,
      TMEZ_AI_MODEL: original.model,
      TMEZ_AI_INPUT_USD_PER_MILLION: original.input,
      TMEZ_AI_OUTPUT_USD_PER_MILLION: original.output,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  assert.equal(aiCostMicros(100, 20, 1, 5), 200)
})
test('concurrent AI reservations respect the monthly budget and settle idempotently', async () => {
  const ids = await Promise.all([
    reserveAiBudget('fixture-a', 6000000, 10),
    reserveAiBudget('fixture-a', 6000000, 10),
  ])
  assert.equal(
    ids.filter(Boolean).length,
    1,
    'concurrent requests cannot both spend the same remaining budget',
  )
  assert.deepEqual(await getAiBudget('fixture-a'), {
    spentMicros: 0,
    reservedMicros: 6000000,
  })
  const id = ids.find(Boolean)
  await settleAiBudget('fixture-a', id, 2000000)
  await settleAiBudget('fixture-a', id, 2000000)
  assert.deepEqual(await getAiBudget('fixture-a'), {
    spentMicros: 2000000,
    reservedMicros: 0,
  })
  const final = await reserveAiBudget('fixture-a', 8000000, 10)
  assert.ok(final)
  assert.equal(await reserveAiBudget('fixture-a', 1, 10), null)
  assert.deepEqual(await getAiBudget('fixture-b'), {
    spentMicros: 0,
    reservedMicros: 0,
  })
  await settleAiBudget('fixture-a', final, 9000000)
  assert.equal(
    (await getAiSettings('fixture-a')).enabled,
    false,
    'unexpected cost above reservation switches AI off',
  )
})


test('customer keys are encrypted, tenant-bound and never fall back to publisher billing', async () => {
  const secrets = load('lib/ai-credentials.ts')
  const previous = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = 'synthetic-encryption-secret-at-least-32-characters'
  try {
    const value = 'sk-fixture-customer-key-not-a-real-credential'
    const cipher = secrets.encryptAiKey('credential-a', 'openai', value)
    assert.equal(cipher.includes(value), false)
    assert.equal(secrets.decryptAiKey('credential-a', 'openai', cipher), value)
    assert.throws(() => secrets.decryptAiKey('credential-b', 'openai', cipher))
    assert.throws(() => secrets.decryptAiKey('credential-a', 'gemini', cipher))
    await secrets.saveCustomerAiKey('credential-a', 'openai', value)
    assert.equal(await secrets.customerAiKey('credential-a', 'openai'), value)
    assert.equal(await secrets.customerAiKey('credential-b', 'openai'), undefined)
    assert.equal(JSON.stringify(await secrets.customerAiConnections('credential-a')).includes(value), false)
    await saveAiSettings('credential-a', { enabled:true,provider:'openai',bracket:'10-50',monthlyLimitUsd:10 })
    await secrets.disconnectCustomerAiKey('credential-a','openai')
    assert.equal(await secrets.customerAiKey('credential-a', 'openai'), undefined)
    assert.equal((await getAiSettings('credential-a')).enabled, false)
    assert.equal(aiProviderConfig('openai').key, undefined)
  } finally {
    if(previous === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = previous
  }
})
