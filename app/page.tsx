export default function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8">
        <span className="inline-block rounded-full bg-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan">
          Support ticketing for GoHighLevel
        </span>
      </div>
      <h1 className="text-4xl md:text-5xl leading-tight mb-4">TicketingMadeEZ</h1>
      <p className="text-lg text-ink/70 mb-8">
        A native helpdesk that runs inside your GHL sub-accounts. Pipelines, workflows, email-to-ticket, SLA tracking. No external system to log into.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        <Card title="Free tier">
          <ul className="space-y-1 text-sm">
            <li>Single ticket queue</li>
            <li>Email-to-ticket</li>
            <li>Auto-acknowledgement</li>
            <li>Manual or round-robin assignment</li>
          </ul>
        </Card>
        <Card title="Paid tier ($15/mo)">
          <ul className="space-y-1 text-sm">
            <li>Multi-department routing</li>
            <li>SLA policies + breach alerts</li>
            <li>Response time and resolution reporting</li>
          </ul>
        </Card>
      </div>
      <p className="text-sm text-ink/50">
        Install from the GoHighLevel Marketplace. Setup is one click. Support ticketing (helpdesk), not event ticketing.
      </p>
      <footer className="mt-16 border-t border-ink/10 pt-6 text-xs text-ink/50">
        A NexBDM<sup>&trade;</sup> product.
      </footer>
    </main>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink/10 p-5">
      <h2 className="text-base mb-2">{title}</h2>
      {children}
    </div>
  )
}
