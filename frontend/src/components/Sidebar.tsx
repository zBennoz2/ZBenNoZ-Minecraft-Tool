import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { resolveApiErrorMessage } from '../api'
import { logout } from '../api/auth'

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  `nav-link${isActive ? ' active' : ''}`

export function Sidebar() {
  const year = new Date().getFullYear()
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    setLogoutError(null)
    try {
      await logout()
      window.location.reload()
    } catch (error) {
      setLogoutError(resolveApiErrorMessage(error))
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__title">ZBenNoZ Gaming</div>
        <div className="sidebar__meta">Server Panel</div>
      </div>
      <nav className="sidebar__nav">
        <NavLink to="/" className={linkClassName} end>
          Dashboard
        </NavLink>
        <NavLink to="/system" className={linkClassName}>
          System
        </NavLink>
        <NavLink to="/diagnostics" className={linkClassName}>
          Diagnostics
        </NavLink>
        <NavLink to="/about" className={linkClassName}>
          Support / About
        </NavLink>
      </nav>

      <div className="sidebar__footer">
        <div>© {year} ZBenNoZ Gaming</div>
        <NavLink to="/about">Support</NavLink>
        <button className="btn btn--ghost" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? 'Abmelden…' : 'Abmelden'}
        </button>
        {logoutError ? <div className="page__hint">{logoutError}</div> : null}
      </div>
    </aside>
  )
}

export default Sidebar
