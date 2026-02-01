type GraceMode = 'grace' | 'hard'

const readNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const rawBaseUrl = process.env.AUTH_BASE_URL || process.env.ZBENNOZ_BASE_URL || 'https://zbennoz.com'
const allowInsecure = process.env.AUTH_ALLOW_INSECURE === 'true'

let normalizedBaseUrl = rawBaseUrl.trim().replace(/\/$/, '')
if (normalizedBaseUrl && !normalizedBaseUrl.startsWith('https://') && !allowInsecure) {
  throw new Error('AUTH_BASE_URL must use https:// (set AUTH_ALLOW_INSECURE=true to override)')
}

const graceMode = (process.env.AUTH_GRACE_MODE ?? 'grace') as GraceMode

export const authConfig = {
  baseUrl: normalizedBaseUrl,
  graceMode,
  graceHours: readNumber(process.env.AUTH_GRACE_HOURS, 24),
  licenseTtlMinutes: readNumber(process.env.LICENSE_CHECK_INTERVAL_MINUTES, 15),
  requestTimeoutMs: readNumber(process.env.AUTH_REQUEST_TIMEOUT_MS, 12000),
  userAgent: process.env.AUTH_USER_AGENT || 'minecraft-amp-client/1.0',
}

export type { GraceMode }
