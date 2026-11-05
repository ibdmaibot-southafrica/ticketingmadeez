import { Header } from '../_components/Header'
import { HubClient } from '../_components/HubClient'
import { getInstall } from '@/lib/kv'
import { getFeaturePlan } from '@/lib/entitlements'
import { NoInstall, NoLocation } from '../_components/NoLocation'
export const dynamic = 'force-dynamic'
export default async function ProjectsPage({
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
        title="Projects and time"
        plan={getFeaturePlan(install)}
        subtitle="Coordinate work, record time and review billable entries"
      />
      <HubClient locationId={locationId} mode="projects" />
    </>
  )
}
