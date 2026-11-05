import { AiBillingNotice } from '../../help/HelpGuide'
export default async function InstallSuccess({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald/10 text-emerald text-2xl">
        &#10003;
      </div>
      <h1 className="text-3xl mb-3">Install complete</h1>
      <p className="text-ink/70 mb-8">
        Your support queue is ready. Open Support Tickets inside your CRM. Use the setup guide to configure email intake and acknowledgement workflows before sending customer messages.
      </p>
      <div className="mb-6 text-left"><AiBillingNotice/></div>
      <p className="mb-6 text-sm">A paid app subscription starts automatically after its 14-day trial unless cancelled before the trial ends. Check your Marketplace subscription for the exact end date and future charge. This includes no AI usage.</p>
      <a href="/help" className="inline-block rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">Open the setup guide</a>
      {locationId ? (
        <p className="text-xs text-ink/40 font-mono">Location: {locationId}</p>
      ) : null}
    </main>
  )
}
