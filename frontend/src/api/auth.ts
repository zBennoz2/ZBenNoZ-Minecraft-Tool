import { fetchApi } from '../api'
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

type LoginErrorResponse = {
  error: string
  message: string
  device_limit?: number
  devices_used?: number
}

type LoginSuccessResponse = {
  ok: true
  user?: AuthUser
  message?: string
}

type LoginResponse = LoginSuccessResponse | LoginErrorResponse

const isLoginErrorResponse = (response: LoginResponse): response is LoginErrorResponse => 'error' in response

const mapLoginResponseToResult = (response: LoginResponse): LoginResult => {
  if (isLoginErrorResponse(response)) {
    return {
      ok: false,
      message: response.message,
      error_code: response.error,
      device_limit: response.device_limit,
      devices_used: response.devices_used,
    }
  }

  return { ok: true, user: response.user, message: response.message }
}

export async function getSession(): Promise<AuthSession> {
  return fetchApi<AuthSession>('/api/auth/session', { cache: 'no-store' })
}

export async function login(identifier: string, password: string, remember: boolean): Promise<LoginResult> {
  const result = await fetchApi<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password, remember }),
  })

  return mapLoginResponseToResult(result)
}

export async function logout(): Promise<void> {
  await fetchApi('/api/auth/logout', { method: 'POST' })
}
