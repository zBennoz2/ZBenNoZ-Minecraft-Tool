import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export function Layout() {
  return (
    <div className="layout">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
