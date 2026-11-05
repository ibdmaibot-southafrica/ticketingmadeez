'use client'
export default function AccountError({ reset }: { reset: () => void }) {
  return <div className="p-8"><h1 className="text-2xl">Account data could not load</h1><p role="alert" className="mt-3 text-sm">The CRM or app did not finish the request. This is not an empty ticket list or a zero report. Wait a moment and try again.</p><button className="mt-5 rounded-lg bg-ink px-4 py-2 text-sm text-white" onClick={reset}>Retry loading account data</button></div>
}
