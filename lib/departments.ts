import { getInstall, updateInstall, getPool, type Department, type LocationInstall } from './kv'

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

async function changeDepartments(locationId: string, change: (current: Department[]) => Department[]) {
  const client=await getPool().connect()
  try {
    await client.query('BEGIN')
    const row=await client.query<{data:LocationInstall}>('SELECT data FROM tmez_installs WHERE location_id=$1 FOR UPDATE',[locationId])
    if(!row.rows[0]) throw new Error('No install')
    const next=change(ensureDefaultDepartments(row.rows[0].data))
    if(new Set(next.map(d=>d.pipelineId)).size!==next.length || new Set(next.map(d=>d.name.toLowerCase())).size!==next.length)
      throw new Error('Each department needs a unique name and pipeline')
    await client.query('UPDATE tmez_installs SET data=data || $2::jsonb,updated_at=NOW() WHERE location_id=$1',[locationId,JSON.stringify({departments:next})])
    await client.query('COMMIT')
    return next
  } catch(e) {await client.query('ROLLBACK');throw e} finally {client.release()}
}
export async function upsertDepartment(locationId: string, dept: Department): Promise<Department[]> {
 return changeDepartments(locationId,current=>{
  const existing=current.find(d=>d.id===dept.id)
  return existing?current.map(d=>d.id===dept.id?{...d,...dept}:d):[...current,dept]
 })
}
export async function patchDepartment(locationId:string,id:string,patch:Partial<Department>) {
 return changeDepartments(locationId,current=>{
  if(!current.some(d=>d.id===id)) throw new Error('Department not found')
  return current.map(d=>d.id===id?{...d,...patch}:d)
 })
}
export async function removeDepartment(locationId: string, deptId: string): Promise<Department[]> {
 return changeDepartments(locationId,current=>{
  if(!current.some(d=>d.id===deptId)) throw new Error('Department not found')
  if(current.length<=1) throw new Error('Cannot delete the last department')
  return current.filter(d=>d.id!==deptId)
 })
}

export function makeDepartmentId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dept'
  return `${slug}-${Math.floor(Math.random() * 100000).toString(36)}`
}
