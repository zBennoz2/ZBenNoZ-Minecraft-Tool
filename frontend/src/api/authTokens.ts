import { API_KEY, apiUrl } from '../config'

export type StoredAuthTokens = {
  accessToken: string
  refreshToken: string
  accessExpiresAt?: string
  refreshExpiresAt?: string
  remember: boolean
}

type LoginTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in?: number
  refresh_expires_in?: number
}

type RefreshTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  refresh_expires_in?: number
}

type RefreshFailure = {
  ok: false
  message?: string
}

type RefreshSuccess = {
  ok: true
  tokens: StoredAuthTokens
}

const STORAGE_KEY = 'zbennoz.auth.tokens'

let cachedTokens: StoredAuthTokens | null | undefined

const resolveExpiresAt = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds)) return undefined
  return new Date(Date.now() + seconds * 1000).toISOString()
}

const readFromStorage = (): StoredAuthTokens | null => {
  if (typeof window === 'undefined') return null
  const localRaw = window.localStorage.getItem(STORAGE_KEY)
  if (localRaw) {
    try {
      const parsed = JSON.parse(localRaw) as StoredAuthTokens
      if (parsed?.accessToken && parsed?.refreshToken) return parsed
    } catch (error) {
      // ignore malformed cache
    }
  }
  const sessionRaw = window.sessionStorage.getItem(STORAGE_KEY)
  if (sessionRaw) {
    try {
      const parsed = JSON.parse(sessionRaw) as StoredAuthTokens
      if (parsed?.accessToken && parsed?.refreshToken) return parsed
    } catch (error) {
      // ignore malformed cache
    }
  }
  return null
}

const writeToStorage = (tokens: StoredAuthTokens) => {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify(tokens)
  if (tokens.remember) {
    window.localStorage.setItem(STORAGE_KEY, payload)
    window.sessionStorage.removeItem(STORAGE_KEY)
  } else {
    window.sessionStorage.setItem(STORAGE_KEY, payload)
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

export const getStoredTokens = (): StoredAuthTokens | null => {
  if (cachedTokens === undefined) {
    cachedTokens = readFromStorage()
  }
  return cachedTokens ?? null
}

export const setStoredTokens = (tokens: Omit<StoredAuthTokens, 'remember'>, remember: boolean) => {
  const next: StoredAuthTokens = { ...tokens, remember }
  cachedTokens = next
  writeToStorage(next)
  return next
}

export const clearStoredTokens = () => {
  cachedTokens = null
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
  window.sessionStorage.removeItem(STORAGE_KEY)
}

export const getAccessToken = () => getStoredTokens()?.accessToken ?? null

export const getRefreshToken = () => getStoredTokens()?.refreshToken ?? null

export const saveTokensFromLoginResponse = (payload: LoginTokenResponse, remember: boolean) => {
  if (!payload.access_token || !payload.refresh_token) return null
  return setStoredTokens(
    {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessExpiresAt: resolveExpiresAt(payload.expires_in),
      refreshExpiresAt: resolveExpiresAt(payload.refresh_expires_in),
    },
    remember,
  )
}

const saveTokensFromRefresh = (payload: RefreshTokenResponse) => {
  const existing = getStoredTokens()
  if (!existing) return null
  if (!payload.access_token) return null
  return setStoredTokens(
    {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? existing.refreshToken,
      accessExpiresAt: resolveExpiresAt(payload.expires_in) ?? existing.accessExpiresAt,
      refreshExpiresAt: resolveExpiresAt(payload.refresh_expires_in) ?? existing.refreshExpiresAt,
    },
    existing.remember,
  )
}

export const refreshAccessToken = async (): Promise<RefreshFailure | RefreshSuccess> => {
  const tokens = getStoredTokens()
  if (!tokens) return { ok: false, message: 'Kein Refresh-Token vorhanden.' }

  const response = await fetch(apiUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
    },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  })

  const payload = (await response.json().catch(() => undefined)) as RefreshTokenResponse | { message?: string } | undefined

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload ? payload.message : undefined
    return { ok: false, message: message || 'Token-Refresh fehlgeschlagen.' }
  }

  const updated = payload ? saveTokensFromRefresh(payload as RefreshTokenResponse) : null
  if (!updated) {
    return { ok: false, message: 'Token-Refresh fehlgeschlagen.' }
  }

  return { ok: true, tokens: updated }
}
