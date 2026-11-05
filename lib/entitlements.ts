import type { LocationInstall, PlanTier } from './kv'

// Included service access is independent of Marketplace subscription events.
export function getFeaturePlan(
  install: Pick<LocationInstall, 'plan' | 'includedPlan'>,
): PlanTier {
  if (install.includedPlan === 'paid' || install.includedPlan === 'enterprise')
    return install.includedPlan
  return install.plan
}
