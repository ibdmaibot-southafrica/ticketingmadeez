export default async function InstallError({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600 text-2xl">
        !
      </div>
      <h1 className="text-3xl mb-3">Install could not complete</h1>
      <p className="text-ink/70 mb-2">Something went wrong finalising the install.</p>
      {reason ? (
        <p className="text-xs text-ink/40 font-mono mb-6">Reason: {reason}</p>
      ) : null}
      <p className="text-sm text-ink/60">
        Please try installing again from the GoHighLevel Marketplace. If the problem persists, contact support via the app listing.
      </p>
    </main>
  )
}
