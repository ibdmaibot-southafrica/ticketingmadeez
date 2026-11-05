const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  Module = require('node:module'),
  ts = require('typescript'),
  path = require('node:path')
function load(file) {
  const m = new Module(path.resolve(file), module)
  m.paths = module.paths
  const originalRequire = m.require.bind(m)
  m.require = (name) =>
    name === './ai-config' ? load('lib/ai-config.ts') : originalRequire(name)
  m._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    file + '.cjs',
  )
  return m.exports
}
const { ticketSla } = load('lib/ticket-sla.ts')
const { validateTicketFile } = load('lib/ticket-files.ts')
const { relevantArticles, knowledgeDraft } = load('lib/knowledge-assist.ts')
const sla = { active: true, firstResponseMinutes: 60, resolutionMinutes: 120 }
test('SLA distinguishes pending, breached and unmeasured historical tickets', () => {
  const createdAt = '2026-11-05T08:00:00Z'
  assert.equal(
    ticketSla({ createdAt, sla }, Date.parse('2026-11-05T08:30:00Z')).label,
    'Response due in 30m',
  )
  assert.equal(
    ticketSla({ createdAt, sla }, Date.parse('2026-11-05T09:01:00Z')).breached,
    true,
  )
  assert.equal(
    ticketSla(
      { createdAt, sla, stageName: 'Resolved' },
      Date.parse('2026-11-05T12:00:00Z'),
    ).label,
    'Historical resolution unmeasured',
  )
  assert.equal(
    ticketSla({
      createdAt,
      sla,
      stageName: 'Resolved',
      firstResponseAt: '2026-11-05T08:15:00Z',
      resolvedAt: '2026-11-05T09:00:00Z',
    }).breached,
    false,
  )
  assert.equal(
    ticketSla({
      createdAt,
      sla,
      stageName: 'Resolved',
      firstResponseAt: '2026-11-05T09:15:00Z',
      resolvedAt: '2026-11-05T09:30:00Z',
    }).breached,
    true,
  )
})
test('attachments reject executable types, path tricks, spoofing and oversized content', () => {
  assert.equal(
    validateTicketFile(
      'note.txt',
      'text/plain',
      Buffer.from('hello').toString('base64'),
    ).toString(),
    'hello',
  )
  assert.throws(() => validateTicketFile('../file.txt', 'text/plain', 'YQ=='))
  assert.throws(() => validateTicketFile('file.html', 'text/html', 'YQ=='))
  assert.throws(() => validateTicketFile('file.pdf', 'application/pdf', 'YQ=='))
  assert.throws(() =>
    validateTicketFile(
      'file.txt',
      'text/plain',
      Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString('base64'),
    ),
  )
})
test('AI drafting uses published account articles, disables provider storage and never sends messages', async () => {
  const articles = [
    {
      id: 'public',
      data: {
        title: 'Password reset',
        body: 'Use the reset link.',
        published: true,
      },
    },
    {
      id: 'private',
      data: {
        title: 'Password secret',
        body: 'PRIVATE ARTICLE',
        published: false,
      },
    },
  ]
  const selected = relevantArticles('How do I reset my password?', articles)
  assert.deepEqual(
    selected.map((a) => a.id),
    ['public'],
  )
  const originalFetch = global.fetch,
    originalKey = process.env.TMEZ_AI_API_KEY,
    originalModel = process.env.TMEZ_AI_MODEL
  process.env.TMEZ_AI_API_KEY = 'isolated-fixture-key'
  process.env.TMEZ_AI_MODEL = 'isolated-fixture-model'
  let calls = 0
  global.fetch = async (url, options) => {
    calls++
    assert.equal(url, 'https://api.openai.com/v1/responses')
    const payload = JSON.parse(options.body)
    assert.equal(payload.store, false)
    assert.equal(payload.max_output_tokens, 600)
    assert.doesNotMatch(payload.input, /PRIVATE ARTICLE/)
    assert.match(payload.instructions, /untrusted data/)
    return Response.json({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Use the reset link.' }],
        },
      ],
    })
  }
  try {
    assert.equal(
      (await knowledgeDraft('Reset password', articles, 'openai', 'isolated-fixture-key')).text,
      'Use the reset link.',
    )
    assert.equal(calls, 1)
  } finally {
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.TMEZ_AI_API_KEY
    else process.env.TMEZ_AI_API_KEY = originalKey
    if (originalModel === undefined) delete process.env.TMEZ_AI_MODEL
    else process.env.TMEZ_AI_MODEL = originalModel
  }
})

test('Claude and Gemini adapters parse drafts and billable usage without live provider calls', async () => {
  const originalFetch = global.fetch
  const names = [
    'TMEZ_ANTHROPIC_API_KEY',
    'TMEZ_ANTHROPIC_MODEL',
    'TMEZ_GEMINI_API_KEY',
    'TMEZ_GEMINI_MODEL',
  ]
  const originals = new Map(names.map((name) => [name, process.env[name]]))
  for (const name of names) process.env[name] = 'isolated-fixture'
  let calls = 0
  global.fetch = async (url, options) => {
    calls++
    const payload = JSON.parse(options.body)
    if (String(url).includes('anthropic.com')) {
      assert.equal(options.headers['x-api-key'], 'isolated-fixture')
      assert.equal(payload.max_tokens, 600)
      return Response.json({
        content: [{ type: 'text', text: 'Claude fixture answer' }],
        usage: { input_tokens: 12, output_tokens: 4 },
      })
    }
    assert.match(
      String(url),
      /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//,
    )
    assert.equal(options.headers['x-goog-api-key'], 'isolated-fixture')
    assert.equal(payload.generationConfig.maxOutputTokens, 600)
    return Response.json({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'Private thinking must not be returned' },
              { text: 'Gemini fixture answer' },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 8,
      },
    })
  }
  try {
    const claude = await knowledgeDraft('Question', [], 'anthropic', 'isolated-fixture')
    assert.deepEqual(claude, {
      text: 'Claude fixture answer',
      inputTokens: 12,
      outputTokens: 4,
    })
    const gemini = await knowledgeDraft('Question', [], 'gemini', 'isolated-fixture')
    assert.deepEqual(gemini, {
      text: 'Gemini fixture answer',
      inputTokens: 12,
      outputTokens: 12,
    })
    assert.equal(calls, 2)
  } finally {
    global.fetch = originalFetch
    for (const [name, value] of originals) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
