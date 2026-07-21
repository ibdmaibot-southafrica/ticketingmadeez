import { getInstall } from '@/lib/kv'
import { getAssignmentPoolStatus, POOL_CAPS, CUSTOM_DEVELOPMENT_THRESHOLD } from '@/lib/assignment'
import { displayName } from '@/lib/users'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'

export const dynamic = 'force-dynamic'

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const install = await getInstall(locationId)
  if (!install) return <NoInstall locationId={locationId} />
  const pool = await getAssignmentPoolStatus(locationId)

  return (
    <div>
      <Header title="Settings" plan={install.plan} />
      <div className="p-8 max-w-3xl space-y-6">
        <Panel title="Auto-assignment">
          <p className="text-sm text-ink/70 mb-3">
            New tickets are round-robin assigned across the users in your sub-account. The pool is capped at {POOL_CAPS[install.plan]} users on the <b>{install.plan}</b> tier.
          </p>
          {pool ? (
            <>
              <div className="grid grid-cols-3 gap-3 py-1.5 border-b border-ink/5">
                <div className="text-xs text-ink/60 self-center">Users in sub-account</div>
                <div className="col-span-2 text-sm text-ink">{pool.total}</div>
              </div>
              <div className="grid grid-cols-3 gap-3 py-1.5 border-b border-ink/5">
                <div className="text-xs text-ink/60 self-center">In rotation</div>
                <div className="col-span-2 text-sm text-ink">
                  {pool.pool.length} of {pool.total} ({install.plan} tier cap: {pool.cap})
                </div>
              </div>
              {pool.pool.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {pool.pool.map((u) => (
                    <span key={u.id} className="inline-flex items-center gap-1 text-[11px] bg-emerald/10 text-emerald px-2 py-0.5 rounded">
                      <span className="h-4 w-4 rounded-full bg-emerald/25 text-emerald text-[9px] font-bold flex items-center justify-center">
                        {displayName(u).slice(0, 1).toUpperCase()}
                      </span>
                      {displayName(u)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2">
                  No location users found in this sub-account. Auto-assignment is idle. Add users in <b>Settings &rsaquo; My Staff</b> and new tickets will start rotating across them automatically.
                </div>
              )}
              {pool.total > CUSTOM_DEVELOPMENT_THRESHOLD ? (
                <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs px-3 py-2">
                  You have {pool.total} users, above the {CUSTOM_DEVELOPMENT_THRESHOLD}-user Enterprise cap. Assignments still work for the first {CUSTOM_DEVELOPMENT_THRESHOLD} users. For larger teams with skills-based routing, load balancing, or calendar-availability filtering, contact us for custom: <a href="mailto:hjr@nexbdm.com" className="underline">hjr@nexbdm.com</a>.
                </div>
              ) : pool.overCap && install.plan === 'free' ? (
                <div className="mt-4 rounded-lg bg-cyan/10 border border-cyan/30 text-ink text-xs px-3 py-2">
                  Free tier caps auto-assign at {POOL_CAPS.free} users. Upgrade to <b>Pro</b> for up to {POOL_CAPS.paid}, or <b>Enterprise</b> for up to {POOL_CAPS.enterprise}.
                </div>
              ) : pool.overCap && install.plan === 'paid' ? (
                <div className="mt-4 rounded-lg bg-cyan/10 border border-cyan/30 text-ink text-xs px-3 py-2">
                  Pro tier caps auto-assign at {POOL_CAPS.paid} users. Upgrade to <b>Enterprise</b> to include up to {POOL_CAPS.enterprise} users in the rotation.
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-ink/50 italic">Unable to load assignment pool status.</p>
          )}
        </Panel>

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
