import { fetchApi } from '../api'

export type LicenseCheckStatus = 'missing' | 'invalid' | 'expired' | 'device_mismatch' | 'active'

export type LicenseStatus = {
  status: LicenseCheckStatus
  message: string
  licenseId?: string
  issuedAt?: string
  expiresAt?: string
  edition?: string
  owner?: string
  maxDevices?: number
  notes?: string
  deviceBinding?: 'required' | 'none'
  activatedAt?: string
  activatedDeviceHash?: string
  deviceHash?: string
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  return fetchApi<LicenseStatus>('/api/license/status', { cache: 'no-store' })
}

export async function activateLicense(licenseToken: string): Promise<LicenseStatus> {
  return fetchApi<LicenseStatus>('/api/license/activate', {
    method: 'POST',
    body: JSON.stringify({ licenseToken }),
  })
}

export async function removeLicense(): Promise<void> {
  await fetchApi('/api/license', { method: 'DELETE' })
}
