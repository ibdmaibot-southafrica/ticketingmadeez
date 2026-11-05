import {
  createHmac,
  timingSafeEqual,
  verify,
  createHash,
  createDecipheriv,
} from 'node:crypto'
export const COOKIE = 'tmez_session'
export type Session = {
  locationId: string
  userId: string
  role: string
  exp: number
}
function secret() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32)
    throw new Error('SESSION_SECRET must contain at least 32 characters')
  return s
}
export function signSession(session: Session) {
  const data = Buffer.from(JSON.stringify(session)).toString('base64url')
  return (
    data + '.' + createHmac('sha256', secret()).update(data).digest('base64url')
  )
}
export function readSession(value?: string): Session | null {
  try {
    if (!value) return null
    const [data, sig, extra] = value.split('.')
    if (extra || !sig) return null
    const expected = createHmac('sha256', secret()).update(data).digest()
    const actual = Buffer.from(sig, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null
    const s = JSON.parse(Buffer.from(data, 'base64url').toString())
    return typeof s.locationId === 'string' &&
      typeof s.userId === 'string' &&
      ['admin', 'user'].includes(s.role) &&
      s.exp > Date.now()
      ? s
      : null
  } catch {
    return null
  }
}
// HighLevel uses the OpenSSL salted AES-256-CBC passphrase format.
export function decryptContext(value: string, passphrase: string) {
  const data = Buffer.from(value, 'base64')
  if (data.length < 32 || data.subarray(0, 8).toString() !== 'Salted__')
    throw new Error('Invalid context')
  const salt = data.subarray(8, 16)
  let material = Buffer.alloc(0)
  let previous = Buffer.alloc(0)
  while (material.length < 48) {
    previous = createHash('md5')
      .update(Buffer.concat([previous, Buffer.from(passphrase), salt]))
      .digest()
    material = Buffer.concat([material, previous])
  }
  const decipher = createDecipheriv(
    'aes-256-cbc',
    material.subarray(0, 32),
    material.subarray(32, 48),
  )
  return JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(16)),
      decipher.final(),
    ]).toString('utf8'),
  )
}
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`
export function verifyWebhook(raw: string, signature: string | null) {
  try {
    return (
      !!signature &&
      verify(
        null,
        Buffer.from(raw),
        PUBLIC_KEY,
        Buffer.from(signature, 'base64'),
      )
    )
  } catch {
    return false
  }
}
export function planFromPayload(p: { planId?: string; status?: string }) {
  if (
    p.status &&
    ['cancelled', 'canceled', 'expired', 'inactive'].includes(
      p.status.toLowerCase(),
    )
  )
    return 'free' as const
  const plans: Record<string, 'free' | 'paid' | 'enterprise'> = {
    '6a5ef1c21222eb1abffd8bf5': 'free',
    '6a5ef2612c2a60b52316bb9d': 'paid',
    '6a5f7ea52c2a60124d3ef51a': 'enterprise',
  }
  return p.planId ? (plans[p.planId] ?? null) : null
}
