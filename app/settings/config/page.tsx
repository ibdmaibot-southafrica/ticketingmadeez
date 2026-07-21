import { getInstall } from '@/lib/kv'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'

export const dynamic = 'force-dynamic'

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const install = await getInstall(locationId)
  if (!install) return <NoInstall locationId={locationId} />

  return (
    <div>
      <Header title="Settings" plan={install.plan} />
      <div className="p-8 max-w-3xl space-y-6">
        <Panel title="Install info">
          <Field label="Location" value={install.locationId} mono />
          <Field label="Plan tier" value={install.plan.toUpperCase()} />
          <Field label="Installed at" value={new Date(install.installedAt).toLocaleString()} />
          {install.companyId ? <Field label="Company" value={install.companyId} mono /> : null}
        </Panel>

        <Panel title="Provisioned resources">
          <Field label="Support Tickets pipeline" value={install.pipelineId ?? 'not set'} mono />
          <Field label="Ticket Priority field" value={install.customFieldIds?.priority ?? 'not set'} mono />
          <Field label="Ticket Source field" value={install.customFieldIds?.source ?? 'not set'} mono />
          <Field label="Ticket Description field" value={install.customFieldIds?.description ?? 'not set'} mono />
        </Panel>

        <Panel title="Getting Started">
          <p className="text-sm text-ink/70">
            Set up email-to-ticket and auto-acknowledge with two GHL workflows. Full guide in the marketplace listing under Documentation.
          </p>
          <ul className="mt-3 text-sm text-ink/70 space-y-1 list-disc pl-5">
            <li>Route your <b>support@yourdomain.com</b> address into your Conversations inbox.</li>
            <li>Add a Workflow: trigger <i>New Conversation</i> (channel: Email), action <i>Create Opportunity</i> in the Support Tickets pipeline.</li>
            <li>Add a Workflow: trigger <i>Opportunity Status Changed</i> to <i>New</i>, action <i>Send Email</i> with your acknowledgement template.</li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      <div className="text-sm font-heading font-bold mb-3">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 border-b border-ink/5 last:border-b-0">
      <div className="text-xs text-ink/60 self-center">{label}</div>
      <div className={'col-span-2 text-sm text-ink ' + (mono ? 'font-mono text-xs' : '')}>{value}</div>
    </div>
  )
}
