import { getInstall, updateInstall, type AssignmentPolicy, type PlanTier } from './kv'
import { ghlJson } from './ghl'
import { listActiveUsers, type GhlUser } from './users'

const DEFAULT_POLICY: AssignmentPolicy = {
  enabled: true,
  strategy: 'round-robin',
}

// Round-robin pool caps per tier.
// - free: up to 3 users participate in the rotation
// - paid: up to 15 users
// - enterprise: up to 100 users (effectively unlimited for typical GHL sub-accounts)
// Users beyond the cap are silently excluded from the current rotation.
export const POOL_CAPS = {
  free: 3,
  paid: 15,
  enterprise: 100,
} as const

// A pool larger than this triggers a "contact us for custom" banner even on
// Enterprise (would need bespoke skills-based routing, load balancing, etc.).
export const CUSTOM_DEVELOPMENT_THRESHOLD = POOL_CAPS.enterprise

export function poolCapForPlan(plan: PlanTier): number {
  return POOL_CAPS[plan] ?? POOL_CAPS.free
}

export type AssignmentPoolStatus = {
  total: number // active users in the sub-account (excluding manually excluded)
  cap: number // hard cap for the current plan
  pool: GhlUser[] // the actual rotating pool (sliced to cap)
  needsEnterprise: boolean // total > ENTERPRISE_THRESHOLD
  overCap: boolean // total > cap (soft: extras are silently excluded)
}

export async function getAssignmentPoolStatus(locationId: string): Promise<AssignmentPoolStatus | null> {
  const install = await getInstall(locationId)
  if (!install) return null
  const policy = install.assignment ?? DEFAULT_POLICY
  const excluded = new Set(policy.excludeUserIds ?? [])
  const users = (await listActiveUsers(locationId).catch(() => [] as GhlUser[])).filter(
    (u) => !excluded.has(u.id),
  )
  const cap = poolCapForPlan(install.plan)
  return {
    total: users.length,
    cap,
    pool: users.slice(0, cap),
    needsEnterprise: users.length > CUSTOM_DEVELOPMENT_THRESHOLD,
    overCap: users.length > cap,
  }
}

/**
 * Round-robin pick of the next assignee for a new ticket in the given location.
 * Rotates through active users in a deterministic order. Persists the cursor
 * on the install so subsequent tickets keep rotating even across process
 * restarts.
 *
 * Returns null when auto-assign is disabled, the pool is empty, or we can't
 * reach the users API.
 */
export async function pickNextAssignee(locationId: string): Promise<GhlUser | null> {
  const install = await getInstall(locationId)
  if (!install) return null
  const policy = install.assignment ?? DEFAULT_POLICY
  if (!policy.enabled) return null

  const users = await listActiveUsers(locationId).catch(() => [] as GhlUser[])
  const excluded = new Set(policy.excludeUserIds ?? [])
  let filtered = users.filter((u) => !excluded.has(u.id))

  // Fallback: GHL's /users/ endpoint requires an agency-scoped token to list
  // users. Our OAuth install gives us a location-scoped token, so this call
  // often returns an empty list even when the sub-account has active users.
  // Use the installing user as a one-person pool so tickets still get owned.
  if (filtered.length === 0 && install.userId && !excluded.has(install.userId)) {
    filtered = [{ id: install.userId }]
  }

  // Cap the rotating pool by tier. Extra users beyond the cap don't
  // participate in this rotation and won't receive auto-assigned tickets.
  const cap = poolCapForPlan(install.plan)
  const pool = filtered.slice(0, cap)
  if (pool.length === 0) return null

  const lastIdx = policy.lastAssignedIndex ?? -1
  const nextIdx = (lastIdx + 1) % pool.length
  const chosen = pool[nextIdx]

  await updateInstall(locationId, {
    assignment: { ...policy, lastAssignedIndex: nextIdx },
  })
  return chosen
}

/**
 * Set assignedTo on an opportunity. Uses PUT /opportunities/{id} which is the
 * documented GHL endpoint for opportunity updates.
 */
export async function assignOpportunity(locationId: string, opportunityId: string, userId: string): Promise<void> {
  await ghlJson(`/opportunities/${encodeURIComponent(opportunityId)}`, {
    locationId,
    method: 'PUT',
    body: JSON.stringify({ assignedTo: userId }),
  })
}

/**
 * Full flow: given a new opp in the Support Tickets pipeline, pick an assignee
 * and set it on the opp. Skips if the opp is already assigned or if the install
 * doesn't have this pipeline (department mismatch).
 */
export async function autoAssignOpportunity(params: {
  locationId: string
  opportunityId: string
  pipelineId: string
  currentAssignedTo?: string | null
}): Promise<{ assignedTo?: string; skipped?: string }> {
  if (params.currentAssignedTo) {
    return { skipped: 'already-assigned' }
  }
  const install = await getInstall(params.locationId)
  if (!install) return { skipped: 'no-install' }

  const knownPipelines = new Set<string>()
  if (install.pipelineId) knownPipelines.add(install.pipelineId)
  for (const d of install.departments ?? []) knownPipelines.add(d.pipelineId)
  if (knownPipelines.size > 0 && !knownPipelines.has(params.pipelineId)) {
    return { skipped: 'unknown-pipeline' }
  }

  const chosen = await pickNextAssignee(params.locationId)
  if (!chosen) return { skipped: 'no-assignee' }

  await assignOpportunity(params.locationId, params.opportunityId, chosen.id)
  return { assignedTo: chosen.id }
}
