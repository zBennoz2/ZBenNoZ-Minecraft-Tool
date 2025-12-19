import { NavLink } from 'react-router-dom'

const linkClassName = ({ isActive }: { isActive: boolean }) =>
  `nav-link${isActive ? ' active' : ''}`

export function Sidebar() {
  const year = new Date().getFullYear()
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
      </div>
    </aside>
  )
}

export default Sidebar
