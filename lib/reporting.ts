import type { Ticket } from './ghl-data'

export type DeptStats = {
  deptName: string
  total: number
  open: number
  resolved: number
  avgResponseMin: number | null
  slaCompliancePct: number | null
  responseSamples: number
  resolutionSamples: number
  volume14: number[]
}

const RESOLVED_STAGE_NAMES = new Set(['resolved', 'closed'])

export function computeStats(
  deptName: string,
  tickets: Ticket[],
  sla?: {
    firstResponseMinutes: number
    resolutionMinutes: number
    active: boolean
  },
): DeptStats {
  const total = tickets.length
  const isResolved = (t: Ticket) =>
    t.stageName && RESOLVED_STAGE_NAMES.has(t.stageName.toLowerCase())
  const resolved = tickets.filter(isResolved).length
  const open = total - resolved

  const responseMinutes: number[] = tickets
    .filter((t) => t.firstResponseAt && t.firstResponseAt >= t.createdAt)
    .map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60000)
  const avgResponseMin =
    responseMinutes.length > 0
      ? Math.round(
          responseMinutes.reduce((s, v) => s + v, 0) / responseMinutes.length,
        )
      : null

  let slaCompliancePct: number | null = null
  const measured = tickets.filter(
    (t) => t.resolvedAt && t.resolvedAt >= t.createdAt,
  )
  if (sla?.active && measured.length > 0) {
    const withinTarget = measured.filter(
      (t) =>
        (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000 <=
        sla.resolutionMinutes,
    ).length
    slaCompliancePct = Math.round((withinTarget / measured.length) * 100)
  }

  const volume14 = new Array(14).fill(0)
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000
  for (const t of tickets) {
    const dayIdx =
      13 - Math.floor((Date.now() - t.createdAt.getTime()) / (24 * 3600 * 1000))
    if (t.createdAt.getTime() >= cutoff && dayIdx >= 0 && dayIdx < 14)
      volume14[dayIdx] += 1
  }

  return {
    deptName,
    total,
    open,
    resolved,
    avgResponseMin,
    slaCompliancePct,
    responseSamples: responseMinutes.length,
    resolutionSamples: measured.length,
    volume14,
  }
}

export function weightedAvg(
  entries: Array<[number | null, number]>,
): number | null {
  const filtered = entries.filter(([v]) => v != null) as Array<[number, number]>
  const w = filtered.reduce((s, [, wt]) => s + wt, 0)
  if (w === 0) return null
  return filtered.reduce((s, [v, wt]) => s + v * wt, 0) / w
}

export function mergeDaily(perDept: number[][]): number[] {
  if (perDept.length === 0) return new Array(14).fill(0)
  const merged = new Array(14).fill(0)
  for (const d of perDept) for (let i = 0; i < 14; i++) merged[i] += d[i] || 0
  return merged
}
