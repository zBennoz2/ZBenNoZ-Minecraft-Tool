import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import BackendGate from './components/BackendGate'
import LicenseGate from './components/LicenseGate'
import ConsolePage from './pages/Console'
import Dashboard from './pages/Dashboard'
import FilesPage from './pages/Files'
import PropertiesPage from './pages/Properties'
import SettingsPage from './pages/Settings'
import WhitelistPage from './pages/Whitelist'
import TasksPage from './pages/Tasks'
import DiagnosticsPage from './pages/Diagnostics'
import AboutSupport from './pages/AboutSupport'
import SystemPage from './pages/System'
import './App.css'

function App() {
  return (
    <BackendGate>
      <LicenseGate>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="instances/:id/console" element={<ConsolePage />} />
            <Route path="instances/:id/files" element={<FilesPage />} />
            <Route path="instances/:id/properties" element={<PropertiesPage />} />
            <Route path="instances/:id/settings" element={<SettingsPage />} />
            <Route path="instances/:id/whitelist" element={<WhitelistPage />} />
            <Route path="instances/:id/tasks" element={<TasksPage />} />
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
