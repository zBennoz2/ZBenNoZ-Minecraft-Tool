import { Outlet } from 'react-router-dom'

export function InstanceWindowLayout() {
  return (
    <div className="instance-layout">
      <main className="main instance-main">
        <Outlet />
      </main>
    </div>
  )
}

export default InstanceWindowLayout
