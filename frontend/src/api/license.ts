import { fetchApi } from '../api'

export type LicenseStatus = {
  active: boolean
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
}

export async function getLicenseStatus(force = false): Promise<LicenseStatus> {
  const query = force ? '?force=1' : ''
  return fetchApi<LicenseStatus>(`/api/license/status${query}`, { cache: 'no-store' })
}
