import { useEffect, useMemo, useState } from 'react'
import packageJson from '../../package.json'
import { SUPPORT_WEBSITE } from '../config'
import { type LicenseStatus } from '../api/license'
import useLicenseStatus from '../hooks/useLicenseStatus'

const APP_VERSION = packageJson.version ?? '—'

export function AboutSupport() {
  const { licenseState, refresh } = useLicenseStatus()
  const [license, setLicense] = useState<LicenseStatus | undefined>(licenseState.status)
  const year = useMemo(() => new Date().getFullYear(), [])

  useEffect(() => {
    if (licenseState.state === 'ready') {
      setLicense(licenseState.status)
    }
  }, [licenseState.state, licenseState.status])

  const licenseStatusLabel = useMemo(() => {
    switch (license?.status) {
      case 'active':
        return 'Aktiv'
      case 'expired':
        return 'Abgelaufen'
      case 'device_mismatch':
        return 'Gerät nicht freigeschaltet'
      case 'invalid':
        return 'Ungültig'
      case 'missing':
      default:
        return 'Fehlt'
    }
  }, [license?.status])

  return (
    <section className="page">
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
            <p className="page__hint">Kostenlose Lizenz, offline gültig. Gerätebindung aktiviert.</p>
          </div>
          <span className="badge">{licenseStatusLabel}</span>
        </div>
        <div className="license-grid">
          <div>
            <div className="label">License ID</div>
            <div className="value">{license?.licenseId ?? '—'}</div>
          </div>
          <div>
            <div className="label">Edition</div>
            <div className="value">{license?.edition ?? 'free'}</div>
          </div>
          <div>
            <div className="label">Besitzer</div>
            <div className="value">{license?.owner ?? '—'}</div>
          </div>
          <div>
            <div className="label">Gültig bis</div>
            <div className="value">{license?.expiresAt ? new Date(license.expiresAt).toLocaleString() : 'kein Ablauf'}</div>
          </div>
          <div>
            <div className="label">Gerätebindung</div>
            <div className="value">{license?.deviceBinding === 'none' ? 'Keine' : 'Erforderlich'}</div>
          </div>
          <div>
            <div className="label">Max. Geräte</div>
            <div className="value">{license?.maxDevices ?? '—'}</div>
          </div>
        </div>
        <div className="license-actions">
          <button className="btn" onClick={refresh}>Status aktualisieren</button>
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
