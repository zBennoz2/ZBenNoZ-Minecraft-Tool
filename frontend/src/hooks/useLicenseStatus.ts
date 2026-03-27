import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSession, login as loginRequest, logout as logoutRequest } from '../api/auth'
import { getLicenseStatus, type LicenseStatus } from '../api/license'

export type AuthState = {
  state: 'checking' | 'ready' | 'error'
  license?: LicenseStatus
  authenticated: boolean
  userName?: string
  message?: string
}

const REFRESH_INTERVAL_MS = 15 * 60 * 1000

export function useLicenseStatus() {
  const [authState, setAuthState] = useState<AuthState>({ state: 'checking', authenticated: false })
  const intervalRef = useRef<number | null>(null)

  const normalizeMessage = useCallback(
    (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value : undefined),
    [],
  )

  const normalizePlan = useCallback((value: LicenseStatus['plan'], planName?: string | null) => {
    if (!value && planName) {
      return { id: null, name: planName }
    }
    if (value && typeof value === 'object') {
      return {
        id: value.id ?? null,
        name: value.name ?? planName ?? null,
      }
    }
    return value ?? (planName ? { id: null, name: planName } : null)
  }, [])

  const normalizeLimits = useCallback(
    (value: LicenseStatus['limits'], deviceLimit?: number | null): LicenseStatus['limits'] => {
      const maxDevices = value?.max_devices ?? deviceLimit ?? null
      if (!value && maxDevices === null) {
        return null
      }
      return {
        max_instances: value?.max_instances ?? null,
        max_devices: maxDevices,
      }
    },
    [],
  )

  const normalizeUsage = useCallback(
    (value: LicenseStatus['usage'], devicesUsed?: number | null): LicenseStatus['usage'] => {
      const resolvedDevicesUsed = value?.devices_used ?? devicesUsed ?? null
      if (!value && resolvedDevicesUsed === null) {
        return null
      }
      return {
        instances_used: value?.instances_used ?? null,
        devices_used: resolvedDevicesUsed,
      }
    },
    [],
  )

  const normalizeSupport = useCallback((value: LicenseStatus['support']): LicenseStatus['support'] => {
    if (!value) return null
    return {
      contact_url: value.contact_url ?? null,
      contact_email: value.contact_email ?? null,
      message: value.message ?? null,
    }
  }, [])

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
      const session = await getSession().catch((error) => {
        const message = error instanceof Error ? error.message : 'Session konnte nicht geladen werden'
        setAuthState({ state: 'error', authenticated: false, message })
        return null
      })
      if (!session?.authenticated) {
        // eslint-disable-next-line no-console
        console.info('[auth] License check skipped: no access token')
        setAuthState({
          state: 'ready',
          authenticated: false,
          license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
        })
        return undefined
      }
      // eslint-disable-next-line no-console
      console.info('[auth] License check token present: yes')
      try {
        const status = await getLicenseStatus(force)
        const normalizedPlan = normalizePlan(status.plan, status.plan_name)
        const normalizedLimits = normalizeLimits(status.limits, status.device_limit)
        const normalizedUsage = normalizeUsage(status.usage, status.devices_used)
        const normalizedSupport = normalizeSupport(status.support)
        const normalizedStatus: LicenseStatus = {
          ...status,
          status: status.status ?? (status.active ? 'active' : 'inactive'),
          message: normalizeMessage(status.message) ?? null,
          reason: status.reason,
          plan: normalizedPlan,
          plan_name: status.plan_name ?? normalizedPlan?.name ?? null,
          limits: normalizedLimits,
          usage: normalizedUsage,
          support: normalizedSupport,
        }
        setAuthState((prev) => ({
          ...prev,
          state: 'ready',
          license: normalizedStatus,
          message: undefined,
          authenticated: Boolean(session?.authenticated) && normalizedStatus.status !== 'unauthenticated',
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
          })
          return undefined
        }
        setAuthState((prev) => ({ ...prev, state: 'error', message: errorMessage }))
        return undefined
      }
    },
    [buildUnauthenticatedStatus, normalizeMessage],
  )

  const loadSession = useCallback(async () => {
    try {
      const session = await getSession()
      const name = session.user?.name || session.user?.email
      const normalizedPlan = normalizePlan(session.license?.plan ?? null, session.license?.plan_name ?? null)
      const normalizedLimits = normalizeLimits(session.license?.limits ?? null, session.license?.device_limit ?? null)
      const normalizedUsage = normalizeUsage(session.license?.usage ?? null, session.license?.devices_used ?? null)
      const normalizedSupport = normalizeSupport(session.license?.support ?? null)
      setAuthState({
        state: 'ready',
        authenticated: session.authenticated,
        license: session.license
          ? {
              ...session.license,
              status: session.license.status ?? (session.license.active ? 'active' : 'inactive'),
              message: normalizeMessage(session.license.message) ?? null,
              plan: normalizedPlan,
              plan_name: session.license.plan_name ?? normalizedPlan?.name ?? null,
              limits: normalizedLimits,
              usage: normalizedUsage,
              support: normalizedSupport,
            }
          : undefined,
        userName: name,
      })
      return session
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Session konnte nicht geladen werden'
      setAuthState({ state: 'error', authenticated: false, message })
      return null
    }
  }, [normalizeMessage])

  useEffect(() => {
    const runBoot = async () => {
      const session = await loadSession()
      if (!session?.authenticated) {
        // eslint-disable-next-line no-console
        console.info('[auth] Boot: access token present: no')
        setAuthState({
          state: 'ready',
          authenticated: false,
          license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
        })
        return
      }
      // eslint-disable-next-line no-console
      console.info('[auth] Boot: access token present: yes')
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
    const session = await loadSession()
    if (session?.authenticated) {
      await refreshLicense(true)
    } else {
      // eslint-disable-next-line no-console
      console.info('[auth] Login completed without stored token, skipping license check')
    }
    return result
  }, [loadSession, refreshLicense])

  const logout = useCallback(async () => {
    await logoutRequest()
    clearTimer()
    setAuthState({
      state: 'ready',
      authenticated: false,
      license: buildUnauthenticatedStatus('Bitte anmelden, um die Lizenz zu prüfen.'),
    })
  }, [])

  const statusLabel = useMemo(() => authState.license?.status ?? 'unauthenticated', [authState.license?.status])

  return { authState, refreshLicense, login, logout, statusLabel }
}

export default useLicenseStatus
