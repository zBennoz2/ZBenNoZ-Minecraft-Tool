import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSession, login as loginRequest, logout as logoutRequest } from '../api/auth'
import { getStoredTokens, type StoredAuthTokens } from '../api/authTokens'
import { getLicenseStatus, type LicenseStatus } from '../api/license'

export type AuthState = {
  state: 'checking' | 'ready' | 'error'
  license?: LicenseStatus
  authenticated: boolean
  userName?: string
  message?: string
  tokens?: StoredAuthTokens | null
}

const REFRESH_INTERVAL_MS = 15 * 60 * 1000

export function useLicenseStatus() {
  const [authState, setAuthState] = useState<AuthState>({ state: 'checking', authenticated: false })
  const intervalRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const refreshLicense = useCallback(
    async (force = false) => {
      try {
        const status = await getLicenseStatus(force)
        const tokens = getStoredTokens()
        setAuthState((prev) => ({
          ...prev,
          state: 'ready',
          license: status,
          message: undefined,
          authenticated: status.status !== 'unauthenticated' && Boolean(tokens?.accessToken || prev.authenticated),
          tokens,
        }))
        return status
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Lizenzstatus konnte nicht geladen werden'
        setAuthState((prev) => ({ ...prev, state: 'error', message, tokens: getStoredTokens() }))
        return undefined
      }
    },
    [],
  )

  const loadSession = useCallback(async () => {
    try {
      const session = await getSession()
      const name = session.user?.name || session.user?.email
      const tokens = getStoredTokens()
      setAuthState({
        state: 'ready',
        authenticated: session.authenticated,
        license: session.license ?? undefined,
        userName: name,
        tokens,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Session konnte nicht geladen werden'
      setAuthState({ state: 'error', authenticated: false, message, tokens: getStoredTokens() })
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  useEffect(() => {
    clearTimer()
    if (authState.authenticated) {
      intervalRef.current = window.setInterval(() => {
        void refreshLicense(false)
      }, REFRESH_INTERVAL_MS)
    }
    return clearTimer
  }, [authState.authenticated, refreshLicense])

  const login = useCallback(async (identifier: string, password: string, remember: boolean) => {
    const result = await loginRequest(identifier, password, remember)
    if (!result.ok) {
      const message = result.message || 'Login fehlgeschlagen.'
      setAuthState((prev) => ({ ...prev, state: 'error', message, authenticated: false }))
      return result
    }
    await loadSession()
    await refreshLicense(true)
    setAuthState((prev) => ({ ...prev, tokens: getStoredTokens() }))
    return result
  }, [loadSession, refreshLicense])

  const logout = useCallback(async () => {
    await logoutRequest()
    clearTimer()
    setAuthState({ state: 'ready', authenticated: false, tokens: null })
  }, [])

  const statusLabel = useMemo(() => authState.license?.status ?? 'unauthenticated', [authState.license?.status])

  return { authState, refreshLicense, login, logout, statusLabel }
}

export default useLicenseStatus
