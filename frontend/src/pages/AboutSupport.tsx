import { useEffect, useMemo, useState } from 'react'
import packageJson from '../../package.json'
import { SUPPORT_WEBSITE } from '../config'
import { type LicenseStatus } from '../api/license'
import useLicenseStatus from '../hooks/useLicenseStatus'
import BackButton from '../components/BackButton'

const APP_VERSION = packageJson.version ?? '—'

export function AboutSupport() {
  const { authState, refreshLicense } = useLicenseStatus()
  const [license, setLicense] = useState<LicenseStatus | undefined>(authState.license)
  const year = useMemo(() => new Date().getFullYear(), [])

  useEffect(() => {
    if (authState.state === 'ready') {
      setLicense(authState.license)
    }
  }, [authState.state, authState.license])

  const licenseStatusLabel = useMemo(() => {
    switch (license?.status) {
      case 'active':
        return 'Aktiv'
      case 'grace':
        return 'Grace-Period'
      case 'offline':
        return 'Offline'
      case 'unauthenticated':
        return 'Abgemeldet'
      case 'inactive':
      default:
        return 'Inaktiv'
    }
  }, [license?.status])

  return (
    <section className="page">
      <div className="page__toolbar">
        <BackButton />
      </div>
      <div className="page__header page__header--spread">
        <div>
          <h1>ZBenNoZ Gaming</h1>
          <p className="page__hint">Modern control center crafted for clarity.</p>
        </div>
        <span className="page__id">Version {APP_VERSION}</span>
      </div>

      <div className="metrics-grid">
        <div className="metrics-card">
          <span className="metrics-card__label">Brand</span>
          <div className="metrics-card__value">ZBenNoZ Gaming</div>
          <p className="page__hint">Soft-dark palette with crisp green accents.</p>
        </div>
        <div className="metrics-card">
          <span className="metrics-card__label">Copyright</span>
          <div className="metrics-card__value">© {year} ZBenNoZ Gaming</div>
          <p className="page__hint">All rights reserved.</p>
        </div>
      </div>

      <div className="support-card">
        <div className="page__header">
          <div>
            <h2>Lizenzstatus</h2>
            <p className="page__hint">Lizenzstatus vom Login-System der Webseite.</p>
          </div>
          <span className="badge">{licenseStatusLabel}</span>
        </div>
        <div className="license-grid">
          <div>
            <div className="label">Plan</div>
            <div className="value">{license?.plan ?? '—'}</div>
          </div>
          <div>
            <div className="label">Aktiv</div>
            <div className="value">{license?.active ? 'Ja' : 'Nein'}</div>
          </div>
          <div>
            <div className="label">Grund</div>
            <div className="value">{license?.reason ?? '—'}</div>
          </div>
          <div>
            <div className="label">Gültig bis</div>
            <div className="value">{license?.expires_at ? new Date(license.expires_at).toLocaleString() : '—'}</div>
          </div>
          <div>
            <div className="label">Geräte (aktiv)</div>
            <div className="value">{license?.devices_used ?? '—'}</div>
          </div>
          <div>
            <div className="label">Geräte-Limit</div>
            <div className="value">{license?.device_limit ?? '—'}</div>
          </div>
        </div>
        <div className="license-actions">
          <button className="btn" onClick={() => refreshLicense(true)}>Status aktualisieren</button>
        </div>
      </div>

      <div className="support-card">
        <div className="page__header">
          <div>
            <h2>Support & Kontakt</h2>
            <p className="page__hint">Die Software ist kostenlos, benötigt aber eine kostenlose Lizenz.</p>
          </div>
          <span className="badge">Support</span>
        </div>
        <ul className="support-list">
          <li>
            <strong>Email:</strong> <span>zbennoz.service@gmail.com</span>
          </li>
          <li>
            <strong>Discord:</strong> <span>ZBenNoZ</span>
          </li>
          <li>
            <strong>Discord (schneller):</strong> <span>ZCronus</span>
          </li>
          <li>
            <strong>Webseite:</strong>{' '}
            <a href={SUPPORT_WEBSITE} target="_blank" rel="noreferrer">
              {SUPPORT_WEBSITE}
            </a>
          </li>
          <li className="page__hint">Support per E-Mail, Discord oder direkt über die Webseite.</li>
          <li className="page__hint">ZCronus antwortet in der Regel am schnellsten.</li>
        </ul>
      </div>

      <div className="footer-inline">
        <span>© {year} ZBenNoZ Gaming Copyright.</span>
        <span>
          Support kostenlos über zbennoz.service@gmail.com · Discord: ZBenNoZ / ZCronus · Webseite: {SUPPORT_WEBSITE}
        </span>
      </div>
    </section>
  )
}

export default AboutSupport
