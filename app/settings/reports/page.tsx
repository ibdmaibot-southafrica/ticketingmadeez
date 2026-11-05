import {
  computeStats,
  weightedAvg,
  mergeDaily,
  type DeptStats,
} from '@/lib/reporting'
import { getInstall, isPaidTier } from '@/lib/kv'
import { readDepartments } from '@/lib/departments'
import {
  getPipeline,
  listOpportunities,
  mapOpportunityToTicket,
  type Ticket,
} from '@/lib/ghl-data'
import { Header, PaidLock } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'

export const dynamic = 'force-dynamic'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>
}) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const install = await getInstall(locationId)
  if (!install) return <NoInstall locationId={locationId} />
  if (!isPaidTier(install.plan))
    return (
      <div>
        <Header title="Reports" plan={install.plan} />
        <PaidLock message="Response time, resolution and SLA reports are available on Pro and Enterprise." />
      </div>
    )
  const data = await readDepartments(locationId)
  if (!data) return <NoInstall locationId={locationId} />
  const { departments } = data

  const perDept: DeptStats[] = []
  for (const dept of departments) {
    const pipeline = await getPipeline(locationId, dept.pipelineId)
    if (!pipeline) continue
    const opps = await listOpportunities(locationId, dept.pipelineId)
    const tickets = opps.map((o) =>
      mapOpportunityToTicket(o, pipeline.stages, install.customFieldIds),
    )
    perDept.push(computeStats(dept.name, tickets, dept.sla))
  }

  const totalTickets = perDept.reduce((s, d) => s + d.total, 0)
  const totalOpen = perDept.reduce((s, d) => s + d.open, 0)
  const totalResolved = perDept.reduce((s, d) => s + d.resolved, 0)
  const resolutionRate =
    totalTickets > 0 ? Math.round((totalResolved / totalTickets) * 100) : 0
  const avgResp = weightedAvg(
    perDept.map((d) => [d.avgResponseMin, d.responseSamples]),
  )
  const compliance = weightedAvg(
    perDept.map((d) => [d.slaCompliancePct, d.resolutionSamples]),
  )
  const merged14 = mergeDaily(perDept.map((d) => d.volume14))

  return (
    <div>
      <Header title="Reports" plan={install.plan} />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatTile
            label="Avg response time"
            value={avgResp == null ? '--' : formatMinutes(avgResp)}
          />
          <StatTile label="Resolution rate" value={`${resolutionRate}%`} />
          <StatTile
            label="SLA compliance"
            value={compliance == null ? '--' : `${Math.round(compliance)}%`}
            paidOnly
            plan={install.plan}
          />
        </div>

        <Panel title="Ticket volume (last 14 days)">
          <LineChart data={merged14} />
        </Panel>

        {isPaidTier(install.plan) ? (
          <Panel title="By department">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink/60 text-xs uppercase tracking-wider">
                  <th className="text-left py-2 font-semibold">Department</th>
                  <th className="text-right py-2 font-semibold">Total</th>
                  <th className="text-right py-2 font-semibold">Open</th>
                  <th className="text-right py-2 font-semibold">Resolved</th>
                  <th className="text-right py-2 font-semibold">
                    Avg response
                  </th>
                  <th className="text-right py-2 font-semibold">SLA</th>
                </tr>
              </thead>
              <tbody>
                {perDept.map((d) => (
                  <tr key={d.deptName} className="border-t border-ink/5">
                    <td className="py-2 font-semibold">{d.deptName}</td>
                    <td className="py-2 text-right">{d.total}</td>
                    <td className="py-2 text-right">{d.open}</td>
                    <td className="py-2 text-right">{d.resolved}</td>
                    <td className="py-2 text-right">
                      {d.avgResponseMin == null
                        ? '--'
                        : formatMinutes(d.avgResponseMin)}
                    </td>
                    <td className="py-2 text-right">
                      {d.slaCompliancePct == null
                        ? '--'
                        : `${d.slaCompliancePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ) : (
          <PaidLock message="Per-department breakdown and SLA compliance metrics are on the Pro tier." />
        )}
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  paidOnly,
  plan,
}: {
  label: string
  value: string
  paidOnly?: boolean
  plan?: string
}) {
  const locked = paidOnly && plan !== 'paid' && plan !== 'enterprise'
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 relative">
      <div className="text-xs text-ink/50 uppercase tracking-wider">
        {label}
      </div>
      <div
        className={
          'mt-1 text-3xl font-heading font-bold ' +
          (locked ? 'text-ink/30' : '')
        }
      >
        {locked ? '--' : value}
      </div>
      {locked ? (
        <div className="mt-1 text-[10px] text-emerald font-semibold">Pro</div>
      ) : null}
    </div>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      <div className="text-sm font-heading font-bold mb-3">{title}</div>
      {children}
    </div>
  )
}

function LineChart({ data }: { data: number[] }) {
  const w = 720
  const h = 160
  const pad = 24
  const max = Math.max(1, ...data)
  const step = (w - pad * 2) / Math.max(1, data.length - 1)
  const points = data
    .map((v, i) => {
      const x = pad + i * step
      const y = h - pad - (v / max) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#e5e7eb" />
      <polyline points={points} fill="none" stroke="#00E5FF" strokeWidth={2} />
      {data.map((v, i) => {
        const x = pad + i * step
        const y = h - pad - (v / max) * (h - pad * 2)
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#00E5FF" />
      })}
    </svg>
  )
}

function formatMinutes(m: number): string {
  const rounded = Math.round(m)
  if (rounded < 60) return `${rounded} min`
  const h = Math.round((rounded / 60) * 10) / 10
  if (h < 24) return `${h}h`
  const d = Math.round((h / 24) * 10) / 10
  return `${d}d`
}
