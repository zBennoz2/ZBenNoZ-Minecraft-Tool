import fs from 'fs'
import path from 'path'
import { authConfig } from '../config/auth'
import { getDataDir } from '../config/paths'
import { getDeviceInfo } from './device.service'
import { getValidAccessToken, logout, registerDevice } from './auth.service'

type LicenseStatus = {
  active: boolean
  status: 'active' | 'inactive' | 'grace' | 'offline' | 'unauthenticated'
  reason?: string
  plan?: string | null
  expires_at?: string | null
  server_time?: string | null
  grace_until?: string | null
  device_limit?: number | null
  devices_used?: number | null
  message?: string | null
  checked_at?: string
}

type LicenseStatusPayload = {
  active: boolean
  expires_at?: string | null
  plan?: string | null
  reason?: string
  server_time?: string
  grace_until?: string | null
  device_limit?: number | null
  devices_used?: number | null
  message?: string
}

type CacheFile = {
  status: LicenseStatus
  checkedAt: string
  lastSuccessAt?: string
}

type RemoteError = {
  error?: string
  message?: string
  device_limit?: number
  devices_used?: number
}

const LICENSE_STATUS_VALUES = ['active', 'inactive', 'grace', 'offline', 'unauthenticated'] as const
type LicenseStatusValue = (typeof LICENSE_STATUS_VALUES)[number]

const CACHE_FILE = path.join(getDataDir(), 'license.status.json')

let lastCheckedAt: number | null = null
let lastStatus: LicenseStatus | null = null
let lastSuccessAt: number | null = null
let backoffMs = 0
let nextAllowedAt = 0

const licenseUrl = (pathSuffix: string) =>
  `${authConfig.baseUrl}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`

const normalizeStatusValue = (value: unknown): LicenseStatus['status'] => {
  if (typeof value === 'string' && LICENSE_STATUS_VALUES.includes(value as LicenseStatusValue)) {
    return value as LicenseStatusValue
  }
  return 'inactive'
}

const normalizeLicenseStatus = (value: Partial<LicenseStatus> | null | undefined): LicenseStatus => {
  const active = Boolean(value?.active)
  const fallbackStatus = active ? 'active' : 'inactive'
  return {
    active,
    status: normalizeStatusValue(value?.status ?? fallbackStatus),
    reason: value?.reason,
    plan: value?.plan ?? null,
    expires_at: value?.expires_at ?? null,
    server_time: value?.server_time ?? null,
    grace_until: value?.grace_until ?? null,
    device_limit: value?.device_limit ?? null,
    devices_used: value?.devices_used ?? null,
    message: value?.message ?? null,
    checked_at: value?.checked_at ?? new Date().toISOString(),
  }
}

const readCache = (): CacheFile | null => {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CacheFile>
    if (!parsed || !parsed.status || !parsed.checkedAt) return null
    return {
      status: normalizeLicenseStatus(parsed.status),
      checkedAt: parsed.checkedAt,
      lastSuccessAt: parsed.lastSuccessAt,
    }
  } catch (error) {
    return null
  }
}

const writeCache = (payload: CacheFile) => {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8')
  } catch (error) {
    // ignore
  }
}

const getGraceUntil = () => {
  if (!lastSuccessAt) return null
  return new Date(lastSuccessAt + authConfig.graceHours * 60 * 60 * 1000).toISOString()
}

const inGraceWindow = () => {
  if (!lastSuccessAt) return false
  return Date.now() <= lastSuccessAt + authConfig.graceHours * 60 * 60 * 1000
}

const applyBackoff = (retryAfterSeconds?: number) => {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    backoffMs = Math.min(retryAfterSeconds * 1000, 15 * 60 * 1000)
  } else {
    backoffMs = backoffMs ? Math.min(backoffMs * 2, 15 * 60 * 1000) : 60 * 1000
  }
  nextAllowedAt = Date.now() + backoffMs
}

const resetBackoff = () => {
  backoffMs = 0
  nextAllowedAt = 0
}

const loadCacheIntoMemory = () => {
  const cached = readCache()
  if (!cached) return
  lastStatus = cached.status
  lastCheckedAt = new Date(cached.checkedAt).getTime()
  lastSuccessAt = cached.lastSuccessAt ? new Date(cached.lastSuccessAt).getTime() : null
}

loadCacheIntoMemory()

const fetchJson = async <T>(url: string, options: RequestInit = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), authConfig.requestTimeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const payload = (await response.json().catch(() => ({}))) as T
    return { response, payload }
  } finally {
    clearTimeout(timeout)
  }
}

const buildStatus = (payload: LicenseStatusPayload, override?: Partial<LicenseStatus>): LicenseStatus => {
  const active = Boolean(override?.active ?? payload.active)
  const baseStatus = active ? 'active' : 'inactive'
  return normalizeLicenseStatus({
    active,
    status: override?.status ?? baseStatus,
    reason: override?.reason ?? payload.reason,
    plan: override?.plan ?? payload.plan ?? null,
    expires_at: override?.expires_at ?? payload.expires_at ?? null,
    server_time: override?.server_time ?? payload.server_time ?? null,
    grace_until: override?.grace_until ?? payload.grace_until ?? null,
    device_limit: override?.device_limit ?? payload.device_limit ?? null,
    devices_used: override?.devices_used ?? payload.devices_used ?? null,
    message: override?.message ?? payload.message ?? null,
    checked_at: override?.checked_at ?? new Date().toISOString(),
  })
}

const applyStatusOverride = (base: LicenseStatus, override: Partial<LicenseStatus> & { status: LicenseStatus['status'] }) =>
  normalizeLicenseStatus({ ...base, ...override })

export const getCachedLicenseStatus = (): LicenseStatus | null => {
  if (lastStatus) return lastStatus
  const cached = readCache()
  if (cached) {
    lastStatus = cached.status
    return cached.status
  }
  return null
}

export const getLicenseStatus = async (options: { force?: boolean } = {}) => {
  const { force } = options

  if (!force && nextAllowedAt && Date.now() < nextAllowedAt) {
    return (
      lastStatus ?? {
        active: false,
        status: 'offline',
        reason: 'rate_limited',
        message: 'Bitte später erneut prüfen.',
        grace_until: getGraceUntil(),
        checked_at: new Date().toISOString(),
      }
    )
  }

  const cacheTtlMs = authConfig.licenseTtlMinutes * 60 * 1000
  if (!force && lastCheckedAt && Date.now() - lastCheckedAt < cacheTtlMs && lastStatus) {
    return lastStatus
  }

  const tokenResult = await getValidAccessToken()
  if (!tokenResult.ok) {
    // eslint-disable-next-line no-console
    console.info('[auth] License check token present: no')
    const status = buildStatus(
      { active: false, reason: 'not_authenticated' },
      { status: 'unauthenticated', active: false, grace_until: getGraceUntil() },
    )
    lastStatus = status
    lastCheckedAt = Date.now()
    writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined })
    return status
  }

  // eslint-disable-next-line no-console
  console.info('[auth] License check token present: yes')
  const deviceResult = await registerDevice(tokenResult.token)
  if (!deviceResult.ok) {
    if (deviceResult.error === 'TOKEN_MISSING' || deviceResult.status === 401) {
      await logout()
      const status = buildStatus(
        { active: false, reason: 'not_authenticated', message: deviceResult.message },
        { status: 'unauthenticated', active: false, grace_until: getGraceUntil() },
      )
      lastStatus = status
      lastCheckedAt = Date.now()
      writeCache({
        status,
        checkedAt: new Date().toISOString(),
        lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined,
      })
      return status
    }
  }

  const device = getDeviceInfo()
  const url = `${licenseUrl('/api/license/status')}?device_id=${encodeURIComponent(device.id)}`

  const { response, payload } = await fetchJson<LicenseStatusPayload | RemoteError>(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenResult.token}`,
      'User-Agent': authConfig.userAgent,
      'X-Device-Id': device.id,
      'X-Device-Name': device.name,
      'X-Device-Platform': device.platform,
      'X-Device-Arch': device.arch,
    },
  })

  lastCheckedAt = Date.now()

  if (response.status === 401 || response.status === 403) {
    await logout()
    const status = buildStatus(
      { active: false, reason: 'session_expired', message: (payload as RemoteError).message },
      { status: 'unauthenticated', active: false },
    )
    lastStatus = status
    writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined })
    return status
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After'))
    applyBackoff(Number.isFinite(retryAfter) ? retryAfter : undefined)
    if (authConfig.graceMode === 'grace' && inGraceWindow() && lastStatus) {
      const status = applyStatusOverride(lastStatus, { status: 'grace', reason: 'rate_limited', grace_until: getGraceUntil() })
      lastStatus = status
      writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: new Date(lastSuccessAt ?? Date.now()).toISOString() })
      return status
    }
    return buildStatus({ active: false, reason: 'rate_limited', message: 'Rate limit erreicht.' }, { status: 'offline' })
  }

  if (!response.ok) {
    applyBackoff()
    if (authConfig.graceMode === 'grace' && inGraceWindow() && lastStatus) {
      const status = applyStatusOverride(lastStatus, { status: 'grace', reason: 'offline', grace_until: getGraceUntil() })
      lastStatus = status
      writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: new Date(lastSuccessAt ?? Date.now()).toISOString() })
      return status
    }
    const errorPayload = payload as RemoteError
    return buildStatus(
      { active: false, reason: errorPayload.error || 'server_error', message: errorPayload.message },
      { status: 'offline', grace_until: getGraceUntil() },
    )
  }

  resetBackoff()
  const statusPayload = payload as LicenseStatusPayload
  const status = buildStatus(statusPayload, statusPayload.active ? { status: 'active', active: true } : { status: 'inactive', active: false })
  lastStatus = status
  lastSuccessAt = Date.now()
  writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: new Date(lastSuccessAt).toISOString() })
  return status
}

export const licenseGuardMiddleware: import('express').RequestHandler = async (_req, res, next) => {
  try {
    const status = await getLicenseStatus()
    if (status.active || status.status === 'grace') {
      return next()
    }
    return res.status(403).json({
      error: 'LICENSE_REQUIRED',
      message: status.message || 'Lizenz nicht aktiv.',
      status,
    })
  } catch (error) {
    return res.status(503).json({
      error: 'LICENSE_CHECK_FAILED',
      message: 'Lizenzprüfung fehlgeschlagen.',
    })
  }
}

export type { LicenseStatus, LicenseStatusPayload }
