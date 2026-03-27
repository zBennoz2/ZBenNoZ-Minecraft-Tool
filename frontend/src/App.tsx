import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import InstanceWindowLayout from './components/InstanceWindowLayout'
import BackendGate from './components/BackendGate'
import LicenseGate from './components/LicenseGate'
import ConsolePage from './pages/Console'
import Dashboard from './pages/Dashboard'
import FilesPage from './pages/Files'
import InstanceDetail from './pages/InstanceDetail'
import InstanceOverview from './pages/InstanceOverview'
import PropertiesPage from './pages/Properties'
import SettingsPage from './pages/Settings'
import WhitelistPage from './pages/Whitelist'
import TasksPage from './pages/Tasks'
import DiagnosticsPage from './pages/Diagnostics'
import AboutSupport from './pages/AboutSupport'
import SystemPage from './pages/System'
import useWindowContext from './hooks/useWindowContext'
import './App.css'

function InstanceWindowFallback() {
  return (
    <section className="page">
      <div className="page__header page__header--spread">
        <div className="page__cluster">
          <h1>Instanzfenster</h1>
          <p className="page__hint">Diese Ansicht ist nur im Dashboard verfügbar.</p>
        </div>
        <button className="btn" type="button" onClick={() => window.close()}>
          Fenster schließen
        </button>
      </div>
    </section>
  )
}

function App() {
  const { isInstanceWindow, instanceId, instanceSearch } = useWindowContext()

  if (isInstanceWindow) {
    const instanceTarget = instanceId
      ? `/instances/${instanceId}${instanceSearch}`
      : null

    return (
      <BackendGate>
        <LicenseGate>
          <Routes>
            <Route element={<InstanceWindowLayout />}>
              <Route path="/instances/:id" element={<InstanceDetail />}>
                <Route index element={<InstanceOverview />} />
                <Route path="console" element={<ConsolePage />} />
                <Route path="files" element={<FilesPage />} />
                <Route path="properties" element={<PropertiesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="whitelist" element={<WhitelistPage />} />
                <Route path="tasks" element={<TasksPage />} />
              </Route>
            </Route>
            <Route
              path="*"
              element={
                instanceTarget ? (
                  <Navigate to={instanceTarget} replace />
                ) : (
                  <InstanceWindowFallback />
                )
              }
            />
          </Routes>
        </LicenseGate>
      </BackendGate>
    )
  }

  return (
    <BackendGate>
      <LicenseGate>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="instances/:id" element={<InstanceDetail />}>
              <Route index element={<InstanceOverview />} />
              <Route path="console" element={<ConsolePage />} />
              <Route path="files" element={<FilesPage />} />
              <Route path="properties" element={<PropertiesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="whitelist" element={<WhitelistPage />} />
              <Route path="tasks" element={<TasksPage />} />
            </Route>
            <Route path="system" element={<SystemPage />} />
            <Route path="diagnostics" element={<DiagnosticsPage />} />
            <Route path="about" element={<AboutSupport />} />
          </Route>
        </Routes>
      </LicenseGate>
    </BackendGate>
  )
}

export default App
