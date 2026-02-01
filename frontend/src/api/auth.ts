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
  device_limit?: number
  devices_used?: number
}

export async function getSession(): Promise<AuthSession> {
  return fetchApi<AuthSession>('/api/auth/session', { cache: 'no-store' })
}

export async function login(identifier: string, password: string, remember: boolean): Promise<LoginResult> {
  return fetchApi<LoginResult>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password, remember }),
  })
}

export async function logout(): Promise<void> {
  await fetchApi('/api/auth/logout', { method: 'POST' })
}
