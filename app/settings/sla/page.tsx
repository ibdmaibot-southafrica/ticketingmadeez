import { readDepartments } from '@/lib/departments'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'
import { SlaClient } from './SlaClient'

export const dynamic = 'force-dynamic'

export default async function SlaPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const data = await readDepartments(locationId)
  if (!data) return <NoInstall locationId={locationId} />
  const { install, departments } = data

  return (
    <div>
      <Header
        title="SLA Policies"
        subtitle="Set first-response and resolution targets per department."
        plan={install.plan}
      />
      <div className="p-8">
        <SlaClient locationId={locationId} plan={install.plan} departments={departments} />
      </div>
    </div>
  )
}
