export function NoLocation() {
  return (
    <div className="p-8">
      <div className="max-w-md mx-auto text-center pt-12">
        <div className="text-4xl mb-4">&#128274;</div>
        <h1 className="text-2xl font-heading font-bold mb-2">Open from your sub-account</h1>
        <p className="text-sm text-ink/60">
          This page is designed to be opened from inside your GHL sub-account. Open the TicketingMadeEZ app from the left menu and it will load with the correct location.
        </p>
      </div>
    </div>
  )
}

export function NoInstall({ locationId }: { locationId: string }) {
  return (
    <div className="p-8">
      <div className="max-w-md mx-auto text-center pt-12">
        <div className="text-4xl mb-4">&#9888;&#65039;</div>
        <h1 className="text-2xl font-heading font-bold mb-2">Install not found</h1>
        <p className="text-sm text-ink/60">
          No installation record for location <code className="font-mono text-xs">{locationId}</code>. Reinstall the app from the GHL Marketplace.
        </p>
      </div>
    </div>
  )
}
