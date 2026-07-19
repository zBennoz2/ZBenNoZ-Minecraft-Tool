import { fetchApi } from '../api'
import type { LicenseStatus } from './license'

export type AuthUser = {
  id?: string
  username?: string
  role?: 'admin' | 'instance_admin'
  isAdmin?: boolean
  email?: string
  name?: string
}

export type AuthSession = {
  authenticated: boolean
  role?: 'admin' | 'instance_admin'
  isAdmin?: boolean
  userId?: string
  username?: string
  displayName?: string
  user?: AuthUser
  device?: {
    id: string
    aliases?: string[]
    fingerprint?: string
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
  session?: AuthSession
  sessionActive?: boolean
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
  const response = await fetchApi<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password, remember }),
  })
  const result = mapLoginResponseToResult(response)
  if (!result.ok) return result

  try {
    const session = await getSession()
    const sessionActive = session.authenticated === true && session.role === 'admin' && session.isAdmin === true
    if (!sessionActive) {
      return {
        ok: false,
        error_code: 'SESSION_VALIDATION_FAILED',
        message: 'Die Anmeldung war erfolgreich, aber die Sitzung konnte nicht gespeichert werden. Bitte Cookie-, HTTPS- und Proxy-Konfiguration prüfen.',
        session,
        sessionActive: false,
      }
    }
    return { ...result, session, sessionActive: true }
  } catch {
    return {
      ok: false,
      error_code: 'SESSION_VALIDATION_FAILED',
      message: 'Die Anmeldung war erfolgreich, aber die Sitzung konnte nicht gespeichert werden. Bitte Cookie-, HTTPS- und Proxy-Konfiguration prüfen.',
      sessionActive: false,
    }
  }
}

export async function logout(): Promise<void> {
  await fetchApi('/api/auth/logout', { method: 'POST' })
}

export async function resetSession(): Promise<void> {
  await fetchApi('/api/auth/reset', { method: 'POST' })
}
