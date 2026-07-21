import { readDepartments } from '@/lib/departments'
import { listPipelines } from '@/lib/ghl-data'
import { Header } from '../_components/Header'
import { NoLocation, NoInstall } from '../_components/NoLocation'
import { DepartmentsClient } from './DepartmentsClient'

export const dynamic = 'force-dynamic'

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const { locationId } = await searchParams
  if (!locationId) return <NoLocation />
  const data = await readDepartments(locationId)
  if (!data) return <NoInstall locationId={locationId} />
  const { install, departments } = data
  const pipelines = await listPipelines(locationId)

  return (
    <div>
      <Header
        title="Departments"
        subtitle="Route tickets to different pipelines so each team owns its own queue."
        plan={install.plan}
      />
      <div className="p-8">
        <DepartmentsClient
          locationId={locationId}
          plan={install.plan}
          departments={departments}
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        />
      </div>
    </div>
  )
}
