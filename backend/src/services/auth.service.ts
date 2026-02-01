import { authConfig } from '../config/auth'
import { getDeviceInfo } from './device.service'
import { clearStoredTokens, getStoredTokens, saveStoredTokens, type StoredTokens } from './tokenStore.service'

type LoginPayload = {
  identifier: string
  password: string
  remember?: boolean
}

type LoginResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  refresh_expires_in?: number
  user?: {
    id?: string
    email?: string
    name?: string
  }
  server_time?: string
}

type RefreshResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_expires_in?: number
  server_time?: string
}

type RemoteError = {
  error?: string
  message?: string
  device_limit?: number
  devices_used?: number
}

type LoginFailure = {
  ok: false
  message?: string
  error?: string
  status?: number
  device_limit?: number
  devices_used?: number
}

type LoginSuccess = {
  ok: true
  user?: {
    id?: string
    email?: string
    name?: string
  }
}

export type LoginResult = LoginFailure | LoginSuccess

const authUrl = (path: string) => `${authConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`

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

const resolveExpiresAt = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds)) return undefined
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export const getSession = async () => {
  const tokens = await getStoredTokens()
  const device = getDeviceInfo()
  if (!tokens) {
    // eslint-disable-next-line no-console
    console.info('[auth] Session token present: no')
    return { authenticated: false, device }
  }
  // eslint-disable-next-line no-console
  console.info('[auth] Session token present: yes')
  return {
    authenticated: true,
    user: tokens.user,
    device,
  }
}

export const login = async (payload: LoginPayload): Promise<LoginResult> => {
  const { identifier, password, remember } = payload
  if (!identifier || !password) {
    return { ok: false as const, message: 'Login-Daten fehlen.' }
  }

  const { response, payload: data } = await fetchJson<LoginResponse | RemoteError>(authUrl('/api/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': authConfig.userAgent,
    },
    body: JSON.stringify({ identifier, password, remember: Boolean(remember) }),
  })

  if (!response.ok) {
    const errorData = data as RemoteError
    return {
      ok: false as const,
      message: errorData.message || 'Login fehlgeschlagen.',
      error: errorData.error || 'LOGIN_FAILED',
      status: response.status,
    }
  }

  const loginData = data as LoginResponse
  const hasAccessToken = typeof loginData.access_token === 'string' && loginData.access_token.trim().length > 0
  const hasRefreshToken = typeof loginData.refresh_token === 'string' && loginData.refresh_token.trim().length > 0
  // eslint-disable-next-line no-console
  console.info('[auth] Login response token received:', hasAccessToken ? 'yes' : 'no')
  if (!hasAccessToken || !hasRefreshToken) {
    return {
      ok: false as const,
      message: 'Login fehlgeschlagen: Token fehlt.',
      error: 'TOKEN_MISSING',
      status: 502,
    }
  }

  const tokens: StoredTokens = {
    accessToken: loginData.access_token,
    refreshToken: loginData.refresh_token,
    accessExpiresAt: resolveExpiresAt(loginData.expires_in) ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    refreshExpiresAt: resolveExpiresAt(loginData.refresh_expires_in),
    remember: Boolean(remember),
    user: loginData.user,
  }

  await saveStoredTokens(tokens, true)

  const deviceResult = await registerDevice(tokens.accessToken)
  if (!deviceResult.ok) {
    return deviceResult
  }

  return { ok: true as const, user: loginData.user }
}

export const logout = async () => {
  await clearStoredTokens()
}

export const registerDevice = async (accessToken: string) => {
  const device = getDeviceInfo()
  // eslint-disable-next-line no-console
  console.info('[auth] Device registration token present: yes')
  const { response, payload } = await fetchJson<RemoteError>(authUrl('/api/device/register'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': authConfig.userAgent,
    },
    body: JSON.stringify({
      device_id: device.id,
      device_name: device.name,
      platform: device.platform,
      arch: device.arch,
      os_release: device.osRelease,
      app_version: device.appVersion,
    }),
  })

  if (!response.ok) {
    return {
      ok: false as const,
      message: payload.message || 'Gerät konnte nicht registriert werden.',
      error: payload.error || 'DEVICE_REGISTER_FAILED',
      status: response.status,
      device_limit: payload.device_limit,
      devices_used: payload.devices_used,
    }
  }

  return { ok: true as const }
}

export const refreshAccessToken = async (tokens: StoredTokens) => {
  const { response, payload } = await fetchJson<RefreshResponse | RemoteError>(authUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': authConfig.userAgent,
    },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  })

  if (!response.ok) {
    return { ok: false as const, message: (payload as RemoteError).message || 'Token-Refresh fehlgeschlagen.' }
  }

  const data = payload as RefreshResponse
  const updated: StoredTokens = {
    ...tokens,
    accessToken: data.access_token,
    accessExpiresAt: resolveExpiresAt(data.expires_in) ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    refreshExpiresAt: resolveExpiresAt(data.refresh_expires_in) ?? tokens.refreshExpiresAt,
  }

  await saveStoredTokens(updated, tokens.remember)
  return { ok: true as const, tokens: updated }
}

export const getValidAccessToken = async () => {
  const tokens = await getStoredTokens()
  if (!tokens) return { ok: false as const, reason: 'NO_SESSION' }

  const expiresAt = tokens.accessExpiresAt ? new Date(tokens.accessExpiresAt).getTime() : 0
  const refreshBy = expiresAt - 60 * 1000
  if (Number.isFinite(expiresAt) && Date.now() < refreshBy) {
    return { ok: true as const, token: tokens.accessToken, tokens }
  }

  const refreshResult = await refreshAccessToken(tokens)
  if (!refreshResult.ok) {
    await clearStoredTokens()
    return { ok: false as const, reason: 'REFRESH_FAILED' }
  }

  return { ok: true as const, token: refreshResult.tokens.accessToken, tokens: refreshResult.tokens }
}
