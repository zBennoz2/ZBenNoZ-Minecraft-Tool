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
  error_code?: string
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

type LoginErrorResponse = {
  error_code?: string
  message?: string
  device_limit?: number
  devices_used?: number
  user?: AuthUser
}

type LoginResponse = LoginTokenResponse | LoginErrorResponse

const mapLoginResponseToResult = (response: LoginResponse): LoginResult => {
  if ('access_token' in response && response.access_token && response.refresh_token) {
    return { ok: true, user: response.user, message: response.message }
  }

  return {
    ok: false,
    user: response.user,
    message: response.message,
    error_code: response.error_code,
    device_limit: response.device_limit,
    devices_used: response.devices_used,
  }
}

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
    return mapLoginResponseToResult(result)
  }

  return mapLoginResponseToResult(result)
}

export async function logout(): Promise<void> {
  await fetchApi('/api/auth/logout', { method: 'POST' })
  clearStoredTokens()
}
