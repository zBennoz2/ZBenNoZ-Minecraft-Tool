import { useCallback, useEffect, useState } from 'react'
import { activateLicense, getLicenseStatus, removeLicense, type LicenseStatus } from '../api/license'

export type LicenseState = {
  state: 'checking' | 'ready' | 'error'
  status?: LicenseStatus
  message?: string
}

export function useLicenseStatus() {
  const [licenseState, setLicenseState] = useState<LicenseState>({ state: 'checking' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let disposed = false

    const load = async () => {
      try {
        const status = await getLicenseStatus()
        if (disposed) return
        setLicenseState({ state: 'ready', status })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Lizenzstatus konnte nicht geladen werden'
        if (disposed) return
        setLicenseState({ state: 'error', message })
      }
    }

    load()

    return () => {
      disposed = true
    }
  }, [nonce])

  const refresh = useCallback(() => {
    setLicenseState({ state: 'checking' })
    setNonce((value) => value + 1)
  }, [])

  const activate = useCallback(async (token: string) => {
    const status = await activateLicense(token)
    setLicenseState({ state: 'ready', status })
    return status
  }, [])

  const remove = useCallback(async () => {
    await removeLicense()
    setLicenseState({ state: 'ready', status: { status: 'missing', message: 'Lizenz entfernt.' } })
  }, [])

  return { licenseState, refresh, activate, remove }
}

export default useLicenseStatus
