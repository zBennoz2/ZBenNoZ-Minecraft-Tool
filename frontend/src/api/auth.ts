import { fetchApi } from '../api'
import { clearStoredTokens, saveTokensFromLoginResponse } from './authTokens'
import type { LicenseStatus } from './license'

export type AuthUser = {
  id?: string
  email?: string
  name?: string
}

export type AuthSession = {
  authenticated: boolean
  user?: AuthUser
  device?: {
    id: string
    name: string
    platform: string
    arch: string
    osRelease: string
    appVersion: string
  }
  license?: LicenseStatus | null
}

export type LoginResult = {
  ok: boolean
  user?: AuthUser
  message?: string
  device_limit?: number
  devices_used?: number
}

type LoginTokenResponse = {
  access_token: string
  refresh_token: string
  expires_in?: number
  refresh_expires_in?: number
  user?: AuthUser
  message?: string
}

type LoginResponse = LoginResult | LoginTokenResponse

export async function getSession(): Promise<AuthSession> {
  return fetchApi<AuthSession>('/api/auth/session', { cache: 'no-store' })
}

export async function login(identifier: string, password: string, remember: boolean): Promise<LoginResult> {
  const result = await fetchApi<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password, remember }),
  })

  if ('access_token' in result && result.access_token && result.refresh_token) {
    saveTokensFromLoginResponse(result, remember)
    return { ok: true, user: result.user, message: result.message }
  }

  return result
}

export async function logout(): Promise<void> {
  await fetchApi('/api/auth/logout', { method: 'POST' })
  clearStoredTokens()
}
