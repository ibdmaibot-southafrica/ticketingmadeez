import type { PlanTier } from '@/lib/kv'

export function Header({ title, subtitle, plan, right }: { title: string; subtitle?: string; plan?: PlanTier; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-8 py-6 border-b border-ink/10 bg-white">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-heading font-bold">{title}</h1>
          {plan ? <PlanBadge plan={plan} /> : null}
        </div>
        {subtitle ? <p className="text-sm text-ink/60 mt-1">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0 flex items-center gap-2">{right}</div> : null}
    </div>
  )
}

function PlanBadge({ plan }: { plan: PlanTier }) {
  return plan === 'paid' ? (
    <span className="inline-block rounded-full bg-emerald/15 text-emerald text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5">Pro</span>
  ) : (
    <span className="inline-block rounded-full bg-ink/10 text-ink/70 text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5">Free</span>
  )
}

export function PaidLock({ message = 'Available on the Pro tier.' }: { message?: string }) {
  return (
    <div className="mx-8 my-6 rounded-xl border border-ink/10 bg-white p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald/10 text-emerald">
        &#128274;
      </div>
      <div className="text-lg font-heading font-bold">Pro feature</div>
      <div className="text-sm text-ink/60 mt-2">{message}</div>
      <div className="text-xs text-ink/40 mt-4">Upgrade from the app listing in the GHL Marketplace.</div>
    </div>
  )
}
