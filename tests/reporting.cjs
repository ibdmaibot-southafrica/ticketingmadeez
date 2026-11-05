const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  Module = require('node:module'),
  ts = require('typescript')
const loaded = new Module(
  require('node:path').resolve('lib/reporting.ts'),
  module,
)
loaded.paths = module.paths
loaded._compile(
  ts.transpileModule(fs.readFileSync('lib/reporting.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  'reporting.cjs',
)
const { computeStats, weightedAvg } = loaded.exports
const ticket = {
  id: 'one',
  subject: 'Test',
  stageId: 'closed',
  stageName: 'Closed',
  createdAt: new Date('2026-11-01T08:00:00Z'),
  updatedAt: new Date('2026-11-04T08:00:00Z'),
}
test('last edit is never treated as a measured response or resolution', () => {
  const stats = computeStats('Support', [ticket], {
    active: true,
    firstResponseMinutes: 60,
    resolutionMinutes: 1440,
  })
  assert.equal(stats.avgResponseMin, null)
  assert.equal(stats.slaCompliancePct, null)
  assert.equal(stats.resolved, 1)
})
test('reports use real response and resolution timestamps', () => {
  const measured = {
    ...ticket,
    firstResponseAt: new Date('2026-11-01T08:15:00Z'),
    resolvedAt: new Date('2026-11-01T09:00:00Z'),
  }
  const stats = computeStats('Support', [measured, ticket], {
    active: true,
    firstResponseMinutes: 60,
    resolutionMinutes: 120,
  })
  assert.equal(stats.avgResponseMin, 15)
  assert.equal(stats.slaCompliancePct, 100)
  assert.equal(stats.responseSamples, 1)
  assert.equal(stats.resolutionSamples, 1)
  assert.equal(
    weightedAvg([
      [10, 1],
      [20, 3],
      [null, 100],
    ]),
    17.5,
  )
})
