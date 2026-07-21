import { ghlJson } from './ghl'

export type GhlUser = {
  id: string
  firstName?: string
  lastName?: string
  name?: string
  email?: string
  role?: string
  type?: string
  deleted?: boolean
  isActive?: boolean
  permissions?: Record<string, boolean>
  scopes?: string[]
}

type ListUsersResponse = { users?: GhlUser[] }

export async function listActiveUsers(locationId: string): Promise<GhlUser[]> {
  const res = await ghlJson<ListUsersResponse>(
    `/users/?locationId=${encodeURIComponent(locationId)}`,
    { locationId, method: 'GET' },
  ).catch(() => null)
  const all = res?.users ?? []
  return all
    .filter((u) => !u.deleted)
    .filter((u) => u.isActive !== false)
    .filter((u) => !!u.id)
    // Skip agency admin bot / API user types that should not receive tickets.
    .filter((u) => (u.type ?? '').toLowerCase() !== 'agency')
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function displayName(u: GhlUser): string {
  return (
    u.name ||
    [u.firstName, u.lastName].filter(Boolean).join(' ') ||
    u.email ||
    u.id
  )
}

export async function usersById(locationId: string): Promise<Map<string, string>> {
  const users = await listActiveUsers(locationId).catch(() => [] as GhlUser[])
  return new Map(users.map((u) => [u.id, displayName(u)]))
}
