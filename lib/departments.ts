import { getInstall, updateInstall, type Department, type LocationInstall } from './kv'

export function ensureDefaultDepartments(install: LocationInstall): Department[] {
  if (install.departments && install.departments.length > 0) return install.departments
  if (!install.pipelineId) return []
  return [
    {
      id: 'default',
      name: 'Support',
      pipelineId: install.pipelineId,
      sla: {
        firstResponseMinutes: 60,
        resolutionMinutes: 1440,
        active: true,
      },
    },
  ]
}

export async function readDepartments(locationId: string): Promise<{ install: LocationInstall; departments: Department[] } | null> {
  const install = await getInstall(locationId)
  if (!install) return null
  const departments = ensureDefaultDepartments(install)
  if (!install.departments && departments.length > 0) {
    await updateInstall(locationId, { departments })
  }
  return { install, departments }
}

export async function upsertDepartment(locationId: string, dept: Department): Promise<Department[]> {
  const install = await getInstall(locationId)
  if (!install) throw new Error('No install')
  const existing = ensureDefaultDepartments(install)
  const idx = existing.findIndex((d) => d.id === dept.id)
  const next = [...existing]
  if (idx === -1) next.push(dept)
  else next[idx] = { ...next[idx], ...dept }
  await updateInstall(locationId, { departments: next })
  return next
}

export async function removeDepartment(locationId: string, deptId: string): Promise<Department[]> {
  const install = await getInstall(locationId)
  if (!install) throw new Error('No install')
  const existing = ensureDefaultDepartments(install)
  if (existing.length <= 1) throw new Error('Cannot delete the last department')
  const next = existing.filter((d) => d.id !== deptId)
  await updateInstall(locationId, { departments: next })
  return next
}

export function makeDepartmentId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dept'
  return `${slug}-${Math.floor(Math.random() * 100000).toString(36)}`
}
