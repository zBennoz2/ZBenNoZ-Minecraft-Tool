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

  const normalizeMessage = useCallback(
    (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value : undefined),
    [],
  )

  const buildUnauthenticatedStatus = useCallback(
    (message?: string): LicenseStatus => ({
      active: false,
      status: 'unauthenticated',
      message: normalizeMessage(message) ?? null,
    }),
    [normalizeMessage],
  )

  const clearTimer = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const refreshLicense = useCallback(
    async (force = false) => {
      const tokens = getStoredTokens()
      if (!tokens?.accessToken) {
        // eslint-disable-next-line no-console
        console.info('[auth] License check skipped: no access token')
        setAuthState({
          state: 'ready',
          authenticated: false,
          license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
          tokens: null,
        })
        return undefined
      }
      try {
        const status = await getLicenseStatus(force)
        setAuthState((prev) => ({
          ...prev,
          state: 'ready',
          license: {
            ...status,
            message: normalizeMessage(status.message) ?? null,
          },
          message: undefined,
          authenticated: status.status !== 'unauthenticated' && Boolean(tokens?.accessToken || prev.authenticated),
          tokens,
        }))
        return status
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Lizenzstatus konnte nicht geladen werden'
        if (errorMessage.includes('TOKEN_MISSING')) {
          // eslint-disable-next-line no-console
          console.info('[auth] License check skipped: token missing')
          setAuthState({
            state: 'ready',
            authenticated: false,
            license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
            tokens: null,
          })
          return undefined
        }
        setAuthState((prev) => ({ ...prev, state: 'error', message: errorMessage, tokens: getStoredTokens() }))
        return undefined
      }
    },
    [buildUnauthenticatedStatus, normalizeMessage],
  )

  const loadSession = useCallback(async (tokensOverride?: StoredAuthTokens | null) => {
    try {
      const session = await getSession()
      const name = session.user?.name || session.user?.email
      const tokens = tokensOverride ?? getStoredTokens()
      setAuthState({
        state: 'ready',
        authenticated: session.authenticated && Boolean(tokens?.accessToken),
        license: session.license
          ? { ...session.license, message: normalizeMessage(session.license.message) ?? null }
          : undefined,
        userName: name,
        tokens,
      })
      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Session konnte nicht geladen werden'
      setAuthState({ state: 'error', authenticated: false, message, tokens: getStoredTokens() })
      return null
    }
  }, [normalizeMessage])

  useEffect(() => {
    const tokens = getStoredTokens()
    if (!tokens?.accessToken) {
      // eslint-disable-next-line no-console
      console.info('[auth] Boot: no access token found')
      setAuthState({
        state: 'ready',
        authenticated: false,
        license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
        tokens: null,
      })
      return
    }

    // eslint-disable-next-line no-console
    console.info('[auth] Boot: access token found, loading session')
    const runBoot = async () => {
      const session = await loadSession(tokens)
      if (!session?.authenticated) {
        // eslint-disable-next-line no-console
        console.info('[auth] Boot: session unauthenticated, skipping license check')
        return
      }
      // eslint-disable-next-line no-console
      console.info('[auth] Boot: triggering license check')
      await refreshLicense(true)
    }

    void runBoot()
  }, [buildUnauthenticatedStatus, loadSession, refreshLicense])

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
    const tokens = getStoredTokens()
    const session = await loadSession(tokens)
    if (tokens?.accessToken && session?.authenticated) {
      await refreshLicense(true)
    } else {
      // eslint-disable-next-line no-console
      console.info('[auth] Login completed without stored token, skipping license check')
    }
    setAuthState((prev) => ({ ...prev, tokens: getStoredTokens() }))
    return result
  }, [loadSession, refreshLicense])

  const logout = useCallback(async () => {
    await logoutRequest()
    clearTimer()
    setAuthState({
      state: 'ready',
      authenticated: false,
      tokens: null,
      license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
    })
  }, [])

  const statusLabel = useMemo(() => authState.license?.status ?? 'unauthenticated', [authState.license?.status])

  return { authState, refreshLicense, login, logout, statusLabel }
}

export default useLicenseStatus
