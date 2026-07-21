export default async function InstallPartial({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 text-2xl">
        &#8230;
      </div>
      <h1 className="text-3xl mb-3">Install partially complete</h1>
      <p className="text-ink/70 mb-6">
        Your app is connected but the ticketing pipeline could not be provisioned automatically. Open Settings to retry.
      </p>
      {locationId ? (
        <p className="text-xs text-ink/40 font-mono">Location: {locationId}</p>
      ) : null}
    </main>
  )
}
