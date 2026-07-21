import { getInstall } from '@/lib/kv'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  const install = locationId ? await getInstall(locationId) : null

  if (!locationId) {
    return (
      <main className="p-6 text-sm text-ink/70">
        Missing locationId. This page is designed to be opened from inside GHL.
      </main>
    )
  }
  if (!install) {
    return (
      <main className="p-6 text-sm text-ink/70">
        No install found for location <code className="font-mono">{locationId}</code>. Reinstall the app from the GHL Marketplace.
      </main>
    )
  }

  return (
    <main className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl">TicketingMadeEZ settings</h1>
        <p className="text-sm text-ink/60 mt-1">
          Location <span className="font-mono">{locationId}</span> &middot; Plan <PlanBadge plan={install.plan} />
        </p>
      </header>

      <section className="rounded-2xl border border-ink/10 p-5">
        <h2 className="text-base mb-3">Ticket queue</h2>
        {install.pipelineId ? (
          <p className="text-sm text-ink/70">
            Provisioned. Pipeline id <span className="font-mono">{install.pipelineId}</span>.
          </p>
        ) : (
          <p className="text-sm text-amber-700">Pipeline not yet provisioned. Retry from the install flow.</p>
        )}
      </section>

      <section className="rounded-2xl border border-ink/10 p-5">
        <h2 className="text-base mb-3">Custom fields</h2>
        <ul className="text-sm text-ink/70 space-y-1">
          <li>Priority: <Val id={install.customFieldIds?.priority} /></li>
          <li>Source: <Val id={install.customFieldIds?.source} /></li>
          <li>Description: <Val id={install.customFieldIds?.description} /></li>
        </ul>
      </section>

      <section className="rounded-2xl border border-ink/10 p-5">
        <h2 className="text-base mb-3">Departments &amp; SLA {install.plan === 'free' && <LockedBadge />}</h2>
        {install.plan === 'paid' ? (
          <p className="text-sm text-ink/70">Configure additional pipelines and SLA policies here. UI in progress.</p>
        ) : (
          <p className="text-sm text-ink/60">
            Multi-department routing and SLA tracking are on the paid tier. Upgrade from the GHL Marketplace listing.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-ink/10 p-5">
        <h2 className="text-base mb-3">Reporting {install.plan === 'free' && <LockedBadge />}</h2>
        {install.plan === 'paid' ? (
          <p className="text-sm text-ink/70">Response time, resolution rate, and SLA compliance metrics coming here.</p>
        ) : (
          <p className="text-sm text-ink/60">Paid tier feature.</p>
        )}
      </section>
    </main>
  )
}

function PlanBadge({ plan }: { plan: 'free' | 'paid' }) {
  const styles = plan === 'paid' ? 'bg-emerald/10 text-emerald' : 'bg-ink/10 text-ink/70'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${styles}`}>{plan}</span>
}

function LockedBadge() {
  return <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">Paid</span>
}

function Val({ id }: { id?: string }) {
  return id ? <code className="font-mono text-xs">{id}</code> : <span className="text-ink/40">not set</span>
}
