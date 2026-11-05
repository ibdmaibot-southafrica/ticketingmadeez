export type SlaPolicy = {
  firstResponseMinutes: number
  resolutionMinutes: number
  active: boolean
}
export function ticketSla(
  input: {
    createdAt: Date | string
    firstResponseAt?: Date | string
    resolvedAt?: Date | string | null
    stageName?: string
    sla?: SlaPolicy
  },
  now = Date.now(),
) {
  if (!input.sla?.active) return { label: 'SLA off', breached: false }
  const closed = ['resolved', 'closed'].includes(
    input.stageName?.toLowerCase() ?? '',
  )
  const created = new Date(input.createdAt).getTime()
  if (!Number.isFinite(created))
    return { label: 'SLA unavailable', breached: false }
  if (closed && !input.resolvedAt)
    return { label: 'Historical resolution unmeasured', breached: false }
  const responseLate = input.firstResponseAt
    ? new Date(input.firstResponseAt).getTime() >
      created + input.sla.firstResponseMinutes * 60000
    : !closed && now > created + input.sla.firstResponseMinutes * 60000
  const resolutionLate = input.resolvedAt
    ? new Date(input.resolvedAt).getTime() >
      created + input.sla.resolutionMinutes * 60000
    : !closed && now > created + input.sla.resolutionMinutes * 60000
  if (responseLate || resolutionLate)
    return { label: 'SLA breached', breached: true }
  if (closed) return { label: 'Resolved within target', breached: false }
  const deadline = !input.firstResponseAt
    ? created + input.sla.firstResponseMinutes * 60000
    : created + input.sla.resolutionMinutes * 60000
  const minutes = Math.max(0, Math.ceil((deadline - now) / 60000))
  return {
    label: `${!input.firstResponseAt ? 'Response' : 'Resolution'} due in ${minutes < 60 ? `${minutes}m` : `${Math.ceil(minutes / 60)}h`}`,
    breached: false,
  }
}
