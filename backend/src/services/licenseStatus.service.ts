import fs from 'fs'
import path from 'path'
import { authConfig } from '../config/auth'
import { getDataDir } from '../config/paths'
import { getDeviceInfo } from './device.service'
import { getValidAccessToken, logout, registerDevice } from './auth.service'
import { sanitizeLogPayload } from '../utils/sanitizeLogPayload'

type LicenseStatus = {
  active: boolean
  valid?: boolean
  source?: 'system_admin' | 'license_admin'
  licenseOwner?: string | null
  mainAdmin?: string | null
  licenseCheckedAt?: string
  status: 'active' | 'inactive' | 'grace' | 'offline' | 'unauthenticated'
  reason?: string
  plan?: {
    id?: string | null
    name?: string | null
  } | null
  plan_name?: string | null
  limits?: {
    max_instances?: number | null
    max_devices?: number | null
  } | null
  usage?: {
    instances_used?: number | null
    devices_used?: number | null
  } | null
  support?: {
    contact_url?: string | null
    contact_email?: string | null
    message?: string | null
  } | null
  expires_at?: string | null
  server_time?: string | null
  grace_until?: string | null
  device_limit?: number | null
  devices_used?: number | null
  message?: string | null
  checked_at?: string
  checkedAt?: string
  lastSuccessfulCheckAt?: string
}

type LicenseStatusPayload = {
  active: boolean
  expires_at?: string | null
  plan?: {
    id?: string | null
    name?: string | null
  } | null
  plan_name?: string | null
  limits?: {
    max_instances?: number | null
    max_devices?: number | null
  } | null
  usage?: {
    instances_used?: number | null
    devices_used?: number | null
  } | null
  support?: {
    contact_url?: string | null
    contact_email?: string | null
    message?: string | null
  } | null
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
const GLOBAL_LICENSE_STATUS_FILE = path.join(getDataDir(), 'license_status.json')
const GLOBAL_LICENSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

let lastCheckedAt: number | null = null
let lastStatus: LicenseStatus | null = null
let lastSuccessAt: number | null = null
let backoffMs = 0
let nextAllowedAt = 0

let lastDeviceRegistrationAt: number | null = null
let lastDeviceRegistrationKey: string | null = null

const shouldRegisterDevice = (token: string, force: boolean) => {
  const now = Date.now()
  const tokenSlice = token.slice(-18)
  const device = getDeviceInfo()
  const registrationKey = `${device.id}:${device.fingerprint}:${tokenSlice}`
  const stale = !lastDeviceRegistrationAt || now - lastDeviceRegistrationAt > 12 * 60 * 60 * 1000
  const keyChanged = registrationKey !== lastDeviceRegistrationKey

  if (force || stale || keyChanged) {
    lastDeviceRegistrationAt = now
    lastDeviceRegistrationKey = registrationKey
    return true
  }

  return false
}

const licenseUrl = (pathSuffix: string) =>
  `${authConfig.baseUrl}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`

const normalizeStatusValue = (value: unknown): LicenseStatus['status'] => {
  if (typeof value === 'string' && LICENSE_STATUS_VALUES.includes(value as LicenseStatusValue)) {
    return value as LicenseStatusValue
  }
  return 'inactive'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

const getNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const getBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

const resolvePayloadSource = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return {}
  const data = isRecord(value.data) ? value.data : value
  return isRecord(data.license) ? data.license : data
}

const normalizePlan = (value: unknown, fallbackName?: string): LicenseStatus['plan'] => {
  if (isRecord(value)) {
    const id = getString(value.id ?? value.plan_id ?? value.code)
    const name = getString(value.name ?? value.label ?? value.title ?? value.plan_name ?? fallbackName)
    if (id || name) {
      return { id: id ?? null, name: name ?? null }
    }
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return { id: null, name: value }
  }
  if (fallbackName) {
    return { id: null, name: fallbackName }
  }
  return null
}

const normalizeRemotePayload = (value: unknown): LicenseStatusPayload => {
  const source = resolvePayloadSource(value)
  const statusText = getString(source.status ?? source.license_status ?? source.state)
  const active =
    getBoolean(source.active ?? source.is_active ?? source.license_active) ??
    (statusText ? statusText === 'active' || statusText === 'grace' : false)
  const planName = getString(source.plan_name ?? source.planName ?? source.tier)
  const plan = normalizePlan(source.plan, planName)
  const limitsSource = isRecord(source.limits) ? source.limits : source
  const usageSource = isRecord(source.usage) ? source.usage : source
  const maxInstances = getNumber(
    limitsSource.max_instances ?? limitsSource.maxInstances ?? source.max_instances ?? source.maxInstances,
  )
  const maxDevices = getNumber(
    limitsSource.max_devices ??
      limitsSource.maxDevices ??
      source.max_devices ??
      source.maxDevices ??
      source.device_limit ??
      source.deviceLimit,
  )
  const instancesUsed = getNumber(
    usageSource.instances_used ?? usageSource.instancesUsed ?? source.instances_used ?? source.instancesUsed,
  )
  const devicesUsed = getNumber(
    usageSource.devices_used ??
      usageSource.devicesUsed ??
      source.devices_used ??
      source.devicesUsed ??
      source.device_used ??
      source.deviceUsed,
  )
  const supportSource = isRecord(source.support) ? source.support : {}
  const supportMessage = getString(
    supportSource.message ?? supportSource.support_message ?? source.support_message ?? source.supportMessage,
  )

  return {
    active,
    reason: getString(source.reason ?? source.reason_code ?? source.error ?? source.error_code),
    message: getString(source.message ?? source.msg ?? source.detail ?? source.description),
    plan,
    plan_name: plan?.name ?? planName ?? null,
    limits:
      maxInstances !== undefined || maxDevices !== undefined
        ? { max_instances: maxInstances ?? null, max_devices: maxDevices ?? null }
        : null,
    usage:
      instancesUsed !== undefined || devicesUsed !== undefined
        ? { instances_used: instancesUsed ?? null, devices_used: devicesUsed ?? null }
        : null,
    support:
      supportMessage || getString(supportSource.contact_url ?? supportSource.contactUrl) || getString(supportSource.contact_email ?? supportSource.contactEmail)
        ? {
            contact_url: getString(supportSource.contact_url ?? supportSource.contactUrl) ?? null,
            contact_email: getString(supportSource.contact_email ?? supportSource.contactEmail) ?? null,
            message: supportMessage ?? null,
          }
        : null,
    expires_at: getString(source.expires_at ?? source.expiresAt ?? source.expires ?? source.expiry) ?? null,
    server_time: getString(source.server_time ?? source.serverTime),
    grace_until: getString(source.grace_until ?? source.graceUntil ?? source.grace_end ?? source.graceEndsAt) ?? null,
    device_limit: maxDevices ?? getNumber(source.device_limit ?? source.deviceLimit),
    devices_used: devicesUsed ?? getNumber(source.devices_used ?? source.devicesUsed),
  }
}

const normalizeLicenseStatus = (value: Partial<LicenseStatus> | null | undefined): LicenseStatus => {
  const active = Boolean(value?.active)
  const fallbackStatus = active ? 'active' : 'inactive'
  return {
    active,
    status: normalizeStatusValue(value?.status ?? fallbackStatus),
    reason: value?.reason,
    plan: value?.plan ?? null,
    plan_name: value?.plan_name ?? value?.plan?.name ?? null,
    limits: value?.limits ?? null,
    usage: value?.usage ?? null,
    support: value?.support ?? null,
    expires_at: value?.expires_at ?? null,
    server_time: value?.server_time ?? null,
    grace_until: value?.grace_until ?? null,
    device_limit: value?.device_limit ?? null,
    devices_used: value?.devices_used ?? null,
    message: value?.message ?? null,
    checked_at: value?.checked_at ?? value?.checkedAt ?? new Date().toISOString(),
    checkedAt: value?.checkedAt ?? value?.checked_at ?? value?.licenseCheckedAt ?? new Date().toISOString(),
    lastSuccessfulCheckAt: value?.lastSuccessfulCheckAt,
    valid: value?.valid ?? active,
    source: value?.source ?? 'system_admin',
    licenseOwner: value?.licenseOwner ?? value?.mainAdmin ?? null,
    mainAdmin: value?.mainAdmin ?? value?.licenseOwner ?? null,
    licenseCheckedAt: value?.licenseCheckedAt ?? value?.checkedAt ?? value?.checked_at ?? new Date().toISOString(),
  }
}


const isRecentSuccessfulCheck = (value?: string) => {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && Date.now() - timestamp <= GLOBAL_LICENSE_GRACE_MS
}

const publicGlobalStatus = (status: Partial<LicenseStatus>, message?: string): LicenseStatus => {
  const lastSuccessfulCheckAt = status.lastSuccessfulCheckAt
  const storedValid = status.valid === true || status.active === true
  const graceValid = !storedValid && isRecentSuccessfulCheck(lastSuccessfulCheckAt)
  const checkedAt = status.checkedAt ?? status.licenseCheckedAt ?? status.checked_at ?? new Date().toISOString()
  return normalizeLicenseStatus({
    ...status,
    active: storedValid || graceValid,
    valid: storedValid || graceValid,
    status: storedValid ? 'active' : graceValid ? 'grace' : 'inactive',
    source: status.source ?? 'system_admin',
    checkedAt,
    checked_at: checkedAt,
    licenseCheckedAt: checkedAt,
    lastSuccessfulCheckAt,
    message: message ?? (storedValid || graceValid ? 'Global license valid' : status.message ?? null),
  })
}

export const readGlobalLicenseStatus = (): LicenseStatus | null => {
  try {
    if (!fs.existsSync(GLOBAL_LICENSE_STATUS_FILE)) return null
    const raw = fs.readFileSync(GLOBAL_LICENSE_STATUS_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<LicenseStatus>
    return publicGlobalStatus(parsed)
  } catch (error) {
    return null
  }
}

const writeGlobalLicenseStatus = (status: LicenseStatus) => {
  const now = new Date().toISOString()
  const payload = {
    valid: true,
    active: true,
    status: 'active' as const,
    source: status.source ?? 'system_admin',
    checkedAt: now,
    checked_at: now,
    licenseCheckedAt: now,
    lastSuccessfulCheckAt: now,
    plan: status.plan ?? null,
    plan_name: status.plan_name ?? status.plan?.name ?? null,
    limits: status.limits ?? null,
    usage: status.usage ?? null,
    support: status.support ?? null,
    expires_at: status.expires_at ?? null,
    server_time: status.server_time ?? null,
    grace_until: status.grace_until ?? null,
    device_limit: status.device_limit ?? null,
    devices_used: status.devices_used ?? null,
    message: 'Global license valid',
  }
  fs.mkdirSync(getDataDir(), { recursive: true })
  fs.writeFileSync(GLOBAL_LICENSE_STATUS_FILE, JSON.stringify(payload, null, 2), 'utf-8')
  return publicGlobalStatus(payload)
}

export const getStoredGlobalLicenseStatus = () => {
  const status = readGlobalLicenseStatus()
  if (status) return status
  return publicGlobalStatus(
    { active: false, valid: false, status: 'inactive', source: 'system_admin' },
    'Die globale Softwarelizenz wurde noch nicht durch den Hauptadmin aktiviert. Bitte zuerst als Hauptadmin anmelden.',
  )
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

const clearCacheFile = () => {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE)
      return true
    }
  } catch (error) {
    // ignore
  }
  return false
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
    plan_name: override?.plan_name ?? payload.plan_name ?? payload.plan?.name ?? null,
    limits: override?.limits ?? payload.limits ?? null,
    usage: override?.usage ?? payload.usage ?? null,
    support: override?.support ?? payload.support ?? null,
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

export const getGlobalLicenseStatus = async (_options: { force?: boolean } = {}) => getStoredGlobalLicenseStatus()

export const getCachedLicenseStatus = (): LicenseStatus | null => {
  if (lastStatus) return lastStatus
  const cached = readCache()
  if (cached) {
    lastStatus = cached.status
    return cached.status
  }
  return null
}

export const clearLicenseStatusCache = () => {
  const deleted = clearCacheFile()
  lastCheckedAt = null
  lastStatus = null
  lastSuccessAt = null
  resetBackoff()
  lastDeviceRegistrationAt = null
  lastDeviceRegistrationKey = null
  return { deleted }
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
    const storedGlobalStatus = readGlobalLicenseStatus()
    const status = storedGlobalStatus ?? buildStatus(
      { active: false, reason: 'not_authenticated', message: 'Die globale Softwarelizenz wurde noch nicht durch den Hauptadmin aktiviert. Bitte zuerst als Hauptadmin anmelden.' },
      { status: 'unauthenticated', active: false, grace_until: getGraceUntil() },
    )
    lastStatus = status
    lastCheckedAt = Date.now()
    writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined })
    return status
  }

  // eslint-disable-next-line no-console
  console.info('[auth] License check token present: yes')
  if (shouldRegisterDevice(tokenResult.token, Boolean(force))) {
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
      'X-Device-Fingerprint': device.fingerprint,
      'X-Device-Aliases': device.aliases.join(','),
    },
  })
  const errorPayload = payload as RemoteError
  // eslint-disable-next-line no-console
  console.info('[auth] License status response', {
    url,
    status: response.status,
    error_code: response.ok ? undefined : errorPayload?.error,
    message: response.ok ? undefined : errorPayload?.message,
    payload: sanitizeLogPayload(payload),
  })

  lastCheckedAt = Date.now()

  if (response.status === 401) {
    await logout()
    const status = buildStatus(
      { active: false, reason: 'session_expired', message: (payload as RemoteError).message },
      { status: 'unauthenticated', active: false },
    )
    lastStatus = status
    writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined })
    return status
  }

  if (response.status === 402 || response.status === 403) {
    resetBackoff()
    const statusPayload = normalizeRemotePayload(payload)
    const status = buildStatus(statusPayload, {
      status: 'inactive',
      active: false,
      reason: statusPayload.reason ?? (response.status === 402 ? 'payment_required' : 'forbidden'),
      message:
        statusPayload.message ??
        (response.status === 402 ? 'Lizenz nicht aktiv oder abgelaufen.' : 'Keine Berechtigung für diese Lizenz.'),
    })
    lastStatus = status
    writeCache({
      status,
      checkedAt: new Date().toISOString(),
      lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined,
    })
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
  const statusPayload = normalizeRemotePayload(payload)
  const status = buildStatus(statusPayload, statusPayload.active ? { status: 'active', active: true } : { status: 'inactive', active: false })
  lastStatus = status
  if (status.active) {
    const globalStatus = writeGlobalLicenseStatus(status)
    lastStatus = globalStatus
    lastSuccessAt = Date.now()
    writeCache({ status: globalStatus, checkedAt: new Date().toISOString(), lastSuccessAt: new Date(lastSuccessAt).toISOString() })
    return globalStatus
  }
  writeCache({ status, checkedAt: new Date().toISOString(), lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : undefined })
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
