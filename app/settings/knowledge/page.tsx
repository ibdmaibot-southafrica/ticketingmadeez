import { Header } from '../_components/Header'
import { HubClient } from '../_components/HubClient'
import { getInstall } from '@/lib/kv'
import { getFeaturePlan } from '@/lib/entitlements'
import { NoInstall, NoLocation } from '../_components/NoLocation'
export const dynamic = 'force-dynamic'
export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>
}) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const install = await getInstall(locationId)
  if (!install) return <NoInstall locationId={locationId} />
  return (
    <>
      <Header
        title="Knowledge base"
        plan={getFeaturePlan(install)}
        subtitle="Maintain team answers and publish support articles"
      />
      <HubClient locationId={locationId} mode="knowledge" />
    </>
  )
}
