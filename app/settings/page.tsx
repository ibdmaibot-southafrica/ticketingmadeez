import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function SettingsIndex({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const params = await searchParams
  const qs = new URLSearchParams(params as Record<string, string>).toString()
  redirect(`/settings/tickets${qs ? `?${qs}` : ''}`)
}
