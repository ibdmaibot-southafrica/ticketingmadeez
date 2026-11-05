import { AiBillingNotice } from './help/HelpGuide'
export default function LandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-8">
        <span className="inline-block rounded-full bg-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan">
          Support ticketing helpdesk
        </span>
      </div>
      <h1 className="text-4xl md:text-5xl leading-tight mb-4">TicketingMadeEZ</h1>
      <p className="text-lg text-ink/70 mb-8">
        Keep support tickets, team notes, customer conversations and service work inside your CRM account.
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
        <Card title="Pro features">
          <ul className="space-y-1 text-sm">
            <li>Multi-department routing</li>
            <li>SLA policies and breach indicators</li>
            <li>Response time and resolution reporting</li>
            <li>Customer portal, knowledge articles, projects and time tracking</li>
          </ul>
        </Card>
      </div>
      <section className="mb-6 rounded-2xl bg-ink p-6 text-white"><h2 className="text-2xl">14-day app trial awaiting Marketplace approval</h2><p className="mt-3 text-sm">The 14-day trial is configured in the submitted app update. It is available only when Marketplace checkout explicitly shows a trial. Review your selected plan, trial end date and future subscription charge before subscribing. For paid plans, app billing starts automatically after the trial unless you cancel before it ends. AI usage is excluded.</p><a href="https://marketplace.gohighlevel.com/integration/6a5e75aeb65bde58d9968235" className="mt-4 inline-block rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-ink">View current Marketplace plans</a></section>
      <AiBillingNotice/>
      <p className="mt-6 text-sm"><a href="/help" className="font-semibold underline">Read the setup and direct AI billing guide</a> · <a href="/guides/TicketingMadeEZ_OpenAI_Setup.pdf" className="underline">Download PDF</a></p>
      <p className="mt-4 text-sm text-ink/50">Email intake and acknowledgement use CRM workflows. The setup guide shows the required steps.</p>
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
