import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SUPPORT_WEBSITE } from '../config'
import useLicenseStatus from '../hooks/useLicenseStatus'

const friendlyStatus = (status?: string) => {
  switch (status) {
    case 'active':
      return 'Lizenz aktiv'
    case 'grace':
      return 'Offline (Grace-Period)'
    case 'offline':
      return 'Offline'
    case 'inactive':
      return 'Lizenz nicht aktiv'
    case 'unauthenticated':
    default:
      return 'Abgemeldet'
  }
}

type Props = { children: React.ReactNode }

export function LicenseGate({ children }: Props) {
  const { authState, refreshLicense, login, logout } = useLicenseStatus()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const statusLabel = useMemo(() => friendlyStatus(authState.license?.status), [authState.license?.status])

  useEffect(() => {
    if (authState.license?.active && authState.license?.status === 'active') {
      navigate('/', { replace: true })
    }
  }, [authState.license?.active, authState.license?.status, navigate])

  const handleLogin = async () => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await login(identifier.trim(), password, remember)
      if (!result.ok) {
        setError(result.message || 'Login fehlgeschlagen.')
      } else {
        setSuccess('Login erfolgreich. Lizenzprüfung läuft...')
        setPassword('')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login fehlgeschlagen'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await logout()
      setSuccess('Abgemeldet.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout fehlgeschlagen'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  if (authState.state === 'ready' && (authState.license?.status === 'active' || authState.license?.status === 'grace')) {
    return <>{children}</>
  }

  const isLoading = authState.state === 'checking'
  const statusHint = authState.license?.message ?? authState.message ?? 'Bitte anmelden, um die Lizenz zu prüfen.'
  const isAuthenticated = authState.authenticated
  const isLocked = isAuthenticated && authState.license?.status && authState.license?.status !== 'active' && authState.license?.status !== 'grace'

  return (
    <div className="license-gate">
      <div className={`license-gate__panel ${isLocked ? 'license-gate__panel--locked' : ''}`}>
        <div className="license-gate__header">
          <div>
            <p className="badge">Login & Lizenz</p>
            <h2>{statusLabel}</h2>
            <p className="page__hint">Melde dich mit deinem zbennoz.com Konto an.</p>
          </div>
          <div className="license-gate__link">
            <a href={SUPPORT_WEBSITE} target="_blank" rel="noreferrer">
              Konto verwalten
            </a>
          </div>
        </div>

        <div className="license-gate__body">
          <div className="license-gate__status">
            <span className="label">Status</span>
            <div className="status-line">{statusLabel}</div>
            <p className="page__hint">{statusHint}</p>
            {authState.userName ? (
              <div className="license-meta">
                <div>
                  <span className="label">Account</span>
                  <div className="value">{authState.userName}</div>
                </div>
                {authState.license?.expires_at ? (
                  <div>
                    <span className="label">Gültig bis</span>
                    <div className="value">{new Date(authState.license.expires_at).toLocaleString()}</div>
                  </div>
                ) : null}
                {authState.license?.plan ? (
                  <div>
                    <span className="label">Plan</span>
                    <div className="value">{authState.license.plan}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="license-gate__form form">
            {!isAuthenticated ? (
              <>
                <div className="form__field">
                  <label htmlFor="login-identifier">Benutzername / E-Mail</label>
                  <input
                    id="login-identifier"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="name@domain.de"
                    autoComplete="username"
                  />
                </div>
                <div className="form__field">
                  <label htmlFor="login-password">Passwort</label>
                  <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
                <label className="form-toggle">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span>Angemeldet bleiben</span>
                </label>
              </>
            ) : (
              <div className="page__hint">
                Dein Konto ist angemeldet. Die Lizenzprüfung läuft automatisch im Hintergrund.
              </div>
            )}
            <div className="license-gate__actions">
              {!isAuthenticated ? (
                <button className="btn" onClick={handleLogin} disabled={busy || isLoading || !identifier.trim() || !password}>
                  Anmelden
                </button>
              ) : null}
              <button className="btn btn--secondary" onClick={() => refreshLicense(true)} disabled={busy || isLoading}>
                Erneut prüfen
              </button>
              {isAuthenticated ? (
                <button className="btn btn--ghost" onClick={handleLogout} disabled={busy || isLoading}>
                  Abmelden
                </button>
              ) : null}
            </div>
            {error ? <div className="alert alert--error">{error}</div> : null}
            {success ? <div className="alert alert--success">{success}</div> : null}
          </div>
        </div>

        <div className="license-gate__footer">
          <p className="page__hint">
            Tokens werden sicher im System-Schlüsselbund gespeichert (oder verschlüsselt im App-Datenordner, falls kein
            Schlüsselbund verfügbar ist). Die Lizenz wird regelmäßig geprüft und kann im Offline-Fall eine Grace-Period
            nutzen.
          </p>
        </div>
      </div>
    </div>
  )
}

export default LicenseGate
