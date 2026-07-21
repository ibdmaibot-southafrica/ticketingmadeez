export default async function InstallSuccess({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-emerald/10 text-emerald text-2xl">
        &#10003;
      </div>
      <h1 className="text-3xl mb-3">Install complete</h1>
      <p className="text-ink/70 mb-8">
        Your Support Tickets pipeline, custom fields, and auto-acknowledge workflow have been created in your sub-account. You can now start receiving tickets.
      </p>
      {locationId ? (
        <p className="text-xs text-ink/40 font-mono">Location: {locationId}</p>
      ) : null}
    </main>
  )
}
