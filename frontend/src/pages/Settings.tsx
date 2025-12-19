import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Instance,
  InstanceStartupConfig,
  SleepSettings,
  SleepStatus,
  BackupInfo,
  BackupFormat,
  BackupJob,
  getInstance,
  getInstanceStatus,
  InstanceUpdatePayload,
  startInstance,
  stopInstance,
  updateInstance,
  getSleepSettings,
  updateSleepSettings,
  getSleepStatus,
  listBackups,
  createBackup,
  deleteBackup,
  downloadBackup,
  restoreBackup,
  getBackupJob,
} from '../api'
import { FormRow, FormSection, FormToggle } from '../components/FormLayout'

interface SettingsFormState {
  name: string
  serverType: Instance['serverType']
  minecraftVersion?: string
  memoryMax: string
  javaPath: string
  nogui: boolean
  autoAcceptEula: boolean
  startupMode?: InstanceStartupConfig['mode']
  startupArgs: string
}

interface ValidationState {
  memoryMax?: string
}

const normalizeMemoryInput = (input: string): { value?: string; error?: string } => {
  const raw = input.trim().toUpperCase()
  if (!raw) return { error: 'RAM darf nicht leer sein' }

  const match = raw.match(/^(\d+)([MG]?)$/)
  if (!match) return { error: 'Ungültiges RAM-Format (z. B. 2G oder 4096M)' }

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'RAM muss größer als 0 sein' }
  }

  const unit = match[2] || 'M'
  return { value: `${amount}${unit}` }
}

const buildFormState = (instance: Instance): SettingsFormState => ({
  name: instance.name,
  serverType: instance.serverType,
  minecraftVersion: instance.minecraftVersion,
  memoryMax: instance.memory?.max ?? '2G',
  javaPath: instance.java?.javaPath ?? instance.javaPath ?? '',
  nogui: instance.nogui !== false,
  autoAcceptEula: instance.autoAcceptEula !== false,
  startupMode: instance.startup?.mode,
  startupArgs: (instance.startup?.args ?? []).join(' '),
})

const isRestartRelevantChange = (a: SettingsFormState, b: SettingsFormState) => {
  return (
    a.memoryMax.trim() !== b.memoryMax.trim() ||
    a.javaPath.trim() !== b.javaPath.trim() ||
    a.nogui !== b.nogui ||
    ((a.startupMode === 'script' || b.startupMode === 'script') &&
      a.startupArgs.trim() !== b.startupArgs.trim())
  )
}

const formatTimestamp = (value: number | string | null | undefined) => {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

const formatIdle = (value: number | null | undefined) => {
  if (!value || value <= 0) return '—'
  const seconds = Math.floor(value / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

const formatBytes = (size: number) => {
  if (!Number.isFinite(size)) return '—'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

export function SettingsPage() {
  const { id } = useParams()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restartState, setRestartState] = useState<'idle' | 'stopping' | 'starting' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [status, setStatus] = useState<'running' | 'stopped' | 'unknown' | 'starting' | 'error'>(
    'unknown',
  )
  const [success, setSuccess] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationState>({})
  const [form, setForm] = useState<SettingsFormState | null>(null)
  const [initialForm, setInitialForm] = useState<SettingsFormState | null>(null)
  const [instanceSnapshot, setInstanceSnapshot] = useState<Instance | null>(null)
  const [restartRequired, setRestartRequired] = useState(false)
  const [sleepSettings, setSleepSettings] = useState<SleepSettings | null>(null)
  const [sleepStatus, setSleepStatus] = useState<SleepStatus | null>(null)
  const [sleepLoading, setSleepLoading] = useState(false)
  const [sleepSaving, setSleepSaving] = useState(false)
  const [sleepError, setSleepError] = useState<string | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupFormat, setBackupFormat] = useState<BackupFormat>('zip')
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupJob, setBackupJob] = useState<BackupJob | null>(null)
  const [restoreJob, setRestoreJob] = useState<BackupJob | null>(null)
  const [restoreOptions, setRestoreOptions] = useState({ forceStop: false, preRestoreSnapshot: false, autoStart: false })
  const [restoreInFlight, setRestoreInFlight] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const isDirty = useMemo(() => {
    if (!form || !initialForm) return false
    return JSON.stringify({ ...form, memoryMax: form.memoryMax.trim() }) !==
      JSON.stringify({ ...initialForm, memoryMax: initialForm.memoryMax.trim() })
  }, [form, initialForm])

  const hasValidationError = Object.values(validation).some(Boolean)

  const refreshStatus = async () => {
    if (!id) return 'unknown'
    const nextStatus = await getInstanceStatus(id)
    const normalizedStatus = nextStatus.status ?? 'unknown'
    setStatus(normalizedStatus)
    return normalizedStatus
  }

  const loadSleep = async () => {
    if (!id) return
    setSleepLoading(true)
    setSleepError(null)
    try {
      const [settings, status] = await Promise.all([getSleepSettings(id), getSleepStatus(id)])
      setSleepSettings(settings)
      setSleepStatus(status)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sleep mode'
      setSleepError(message)
    } finally {
      setSleepLoading(false)
    }
  }

  const refreshSleepStatus = async () => {
    if (!id) return
    try {
      const status = await getSleepStatus(id)
      setSleepStatus(status)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh sleep status'
      setSleepError(message)
    }
  }

  const saveSleep = async () => {
    if (!id || !sleepSettings) return
    setSleepSaving(true)
    setSleepError(null)
    try {
      const updated = await updateSleepSettings(id, sleepSettings)
      setSleepSettings(updated)
      await refreshSleepStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save sleep settings'
      setSleepError(message)
    } finally {
      setSleepSaving(false)
    }
  }

  const loadBackups = async () => {
    if (!id) return
    setBackupsLoading(true)
    setBackupError(null)
    try {
      const list = await listBackups(id)
      setBackups(list)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load backups'
      setBackupError(message)
    } finally {
      setBackupsLoading(false)
    }
  }

  const trackJob = (jobId: string, setter: (job: BackupJob) => void, onDone?: () => void) => {
    const poll = async () => {
      if (!id) return
      try {
        const job = await getBackupJob(id, jobId)
        setter(job)
        if (job.status === 'completed') {
          onDone?.()
          return
        }
        if (job.status === 'failed') {
          return
        }
      } catch (err) {
        console.error('Job poll failed', err)
      }

      setTimeout(poll, 2000)
    }

    poll()
  }

  const startBackup = async () => {
    if (!id) return
    setBackupError(null)
    try {
      const response = await createBackup(id, backupFormat)
      const placeholder: BackupJob = {
        id: response.jobId,
        status: 'running',
        progress: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: 'Starting backup',
      }
      setBackupJob(placeholder)
      trackJob(response.jobId, setBackupJob, () => {
        loadBackups()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start backup'
      setBackupError(message)
    }
  }

  const handleRestore = async (backupId: string) => {
    if (!id) return
    setBackupError(null)
    setRestoreInFlight(backupId)
    try {
      const response = await restoreBackup(id, backupId, restoreOptions)
      const placeholder: BackupJob = {
        id: response.jobId,
        status: 'running',
        progress: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: 'Restore starting',
      }
      setRestoreJob(placeholder)
      trackJob(response.jobId, setRestoreJob, () => {
        setRestoreInFlight(null)
        loadBackups()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start restore'
      setBackupError(message)
      setRestoreInFlight(null)
    }
  }

  const handleDeleteBackup = async (backupId: string) => {
    if (!id) return
    try {
      await deleteBackup(id, backupId)
      loadBackups()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete backup'
      setBackupError(message)
    }
  }

  const handleDownloadBackup = async (backupId: string) => {
    if (!id) return
    setDownloadError(null)
    try {
      const blob = await downloadBackup(id, backupId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = backupId
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download backup'
      setDownloadError(message)
    }
  }

  const updateSleepField = (field: keyof SleepSettings, value: boolean | number) => {
    setSleepSettings((prev) => (prev ? { ...prev, [field]: value } : prev))
  }

  const fetchSettings = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setSaveError(null)
    setSuccess(null)
    try {
      const [instanceData, statusData] = await Promise.all([
        getInstance(id),
        getInstanceStatus(id),
      ])
      const nextForm = buildFormState(instanceData)
      setForm(nextForm)
      setInitialForm(nextForm)
      setInstanceSnapshot(instanceData)
      setStatus(statusData.status ?? 'unknown')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
    loadSleep()
    loadBackups()
  }, [id])

  const handleMemoryChange = (value: string) => {
    setForm((prev) => (prev ? { ...prev, memoryMax: value } : prev))
    const normalized = normalizeMemoryInput(value)
    setValidation((prev) => ({ ...prev, memoryMax: normalized.error }))
  }

  const handleToggle = (field: 'nogui' | 'autoAcceptEula') =>
    setForm((prev) => (prev ? { ...prev, [field]: !prev[field] } : prev))

  const handleSave = async () => {
    if (!id || !form || !initialForm || !instanceSnapshot) return

    const normalizedMemory = normalizeMemoryInput(form.memoryMax)
    if (normalizedMemory.error || !normalizedMemory.value) {
      setValidation((prev) => ({ ...prev, memoryMax: normalizedMemory.error }))
      return
    }

    setSaving(true)
    setSaveError(null)
    setSuccess(null)

    const payload: InstanceUpdatePayload = {}

    if (form.name !== initialForm.name) {
      payload.name = form.name
    }

    if (form.memoryMax.trim() !== initialForm.memoryMax.trim()) {
      payload.memory = { ...(instanceSnapshot.memory ?? {}), max: normalizedMemory.value }
    }

    const trimmedJavaPath = form.javaPath.trim()
    if (trimmedJavaPath !== initialForm.javaPath.trim()) {
      payload.javaPath = trimmedJavaPath || null
      payload.java = { ...(instanceSnapshot.java ?? {}), javaPath: trimmedJavaPath || null }
    }

    if (form.nogui !== initialForm.nogui) {
      payload.nogui = form.nogui
    }

    if (form.autoAcceptEula !== initialForm.autoAcceptEula) {
      payload.autoAcceptEula = form.autoAcceptEula
    }

    const parsedArgs = form.startupArgs
      .split(' ')
      .map((entry) => entry.trim())
      .filter(Boolean)

    if (form.startupArgs.trim() !== initialForm.startupArgs.trim()) {
      payload.startup = { ...(instanceSnapshot.startup ?? { mode: form.startupMode ?? 'jar' }) }
      payload.startup.args = parsedArgs
    }

    try {
      const updated = await updateInstance(id, payload)
      const nextForm = buildFormState(updated)
      setForm(nextForm)
      setInitialForm(nextForm)
      setInstanceSnapshot(updated)
      setSuccess('Settings saved')
      const currentStatus = await refreshStatus()
      const restartNeeded = currentStatus === 'running' && isRestartRelevantChange(nextForm, initialForm)
      setRestartRequired(restartNeeded)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings'
      setSaveError(message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (initialForm) {
      setForm(initialForm)
      setValidation({})
      setSaveError(null)
      setSuccess(null)
      setRestartRequired(false)
    }
  }

  const handleRestart = async () => {
    if (!id) return
    setRestartState('stopping')
    setSaveError(null)
    setSuccess(null)
    try {
      await stopInstance(id)
      await refreshStatus()
      setRestartState('starting')
      const startResult = await startInstance(id)
      if (startResult.status === 'needs_java') {
        throw new Error(
          `Instance requires Java ${startResult.recommendedMajor ?? ''}. Please install the recommended runtime and try again.`,
        )
      }
      await refreshStatus()
      setRestartState('idle')
      setRestartRequired(false)
      setSuccess('Instance restarted to apply changes')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart instance'
      setRestartState('error')
      setSaveError(message)
    }
  }

  if (!id) {
    return <div className="alert alert--error">Instance not found</div>
  }

  if (loading) {
    return (
      <section className="page">
        <div className="page__header page__header--spread">
          <div>
            <h1>Settings</h1>
            <p className="page__hint">Loading instance settings…</p>
          </div>
        </div>
        <div className="alert alert--muted">Loading…</div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <div className="page__header page__header--spread">
          <div>
            <h1>Settings</h1>
            <p className="page__hint">Instance: {id}</p>
          </div>
          <button className="btn" onClick={fetchSettings}>
            Retry
          </button>
        </div>
        <div className="alert alert--error">{error}</div>
      </section>
    )
  }

  if (!form || !initialForm) {
    return null
  }

  const restartBanner = restartRequired && status === 'running'

  return (
    <section className="page">
      <div className="page__header page__header--spread">
        <div>
          <h1>Settings</h1>
          <p className="page__hint">Instance: {id}</p>
          <p className="page__hint">Status: {status}</p>
        </div>
        <div className="actions">
          <button className="btn btn--ghost" onClick={fetchSettings} disabled={saving}>
            Reload
          </button>
          <button className="btn btn--secondary" onClick={handleReset} disabled={!isDirty || saving}>
            Reset
          </button>
          <button className="btn" onClick={handleSave} disabled={!isDirty || saving || hasValidationError}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {saveError ? <div className="alert alert--error">{saveError}</div> : null}
      {success ? <div className="alert alert--muted">{success}</div> : null}
      {restartBanner ? (
        <div className="alert alert--muted">
          Restart required to apply changes.
          <div className="actions actions--inline" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={handleRestart}
              disabled={restartState === 'stopping' || restartState === 'starting'}
            >
              {restartState === 'stopping'
                ? 'Stopping…'
                : restartState === 'starting'
                  ? 'Starting…'
                  : 'Restart now'}
            </button>
            <button className="btn btn--secondary" onClick={() => setRestartRequired(false)}>
              Later
            </button>
          </div>
        </div>
      ) : null}

      <div className="form-grid">
        <FormSection title="Server Basics">
          <FormRow label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
            />
          </FormRow>
          <FormRow label="Server Type">
            <input type="text" value={form.serverType} readOnly />
          </FormRow>
          <FormRow label="Minecraft Version">
            <input type="text" value={form.minecraftVersion ?? '—'} readOnly />
          </FormRow>
        </FormSection>

        <FormSection title="Resources">
          <FormRow label="RAM Max" help="z. B. 2G oder 4096M">
            <input
              type="text"
              value={form.memoryMax}
              onChange={(event) => handleMemoryChange(event.target.value)}
              onBlur={(event) => {
                const normalized = normalizeMemoryInput(event.target.value)
                if (normalized.value) {
                  setForm((prev) =>
                    prev ? { ...prev, memoryMax: normalized.value ?? prev.memoryMax } : prev,
                  )
                }
              }}
            />
            {validation.memoryMax ? <small className="form__error">{validation.memoryMax}</small> : null}
          </FormRow>
        </FormSection>

        <FormSection title="Java">
          <FormRow label="Java Path" help="Optional: leer lassen für automatische Erkennung">
            <input
              type="text"
              placeholder="/usr/bin/java"
              value={form.javaPath}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, javaPath: event.target.value } : prev))
              }
            />
          </FormRow>
          <FormRow label="JVM Args" help="Not supported (coming soon)">
            <input type="text" value="Not supported (coming soon)" readOnly />
          </FormRow>
        </FormSection>

        <FormSection title="Startup">
          <FormRow label="nogui">
            <FormToggle label="Server ohne GUI starten" checked={form.nogui} onChange={() => handleToggle('nogui')} />
          </FormRow>
          <FormRow
            label="Startup args"
            help={
              form.startupMode !== 'script'
                ? 'Startup args nur für Script-Mode verfügbar'
                : 'Argumente durch Leerzeichen trennen'
            }
          >
            <input
              type="text"
              value={form.startupArgs}
              onChange={(event) =>
                setForm((prev) => (prev ? { ...prev, startupArgs: event.target.value } : prev))
              }
              placeholder={form.startupMode === 'script' ? 'Arg1 Arg2' : 'Not supported for jar mode'}
              disabled={form.startupMode !== 'script'}
            />
          </FormRow>
        </FormSection>

        <FormSection title="EULA">
          <FormRow
            label="Automatisch akzeptieren"
            help="Wenn aktiviert, schreibt das Panel eula=true vor dem Start."
          >
            <FormToggle
              label="EULA zustimmen"
              checked={form.autoAcceptEula}
              onChange={() => handleToggle('autoAcceptEula')}
            />
          </FormRow>
        </FormSection>

        <FormSection
          title="Sleep Mode"
          description="Stoppt inaktive Server automatisch und weckt sie durch Minecraft-Statuspings."
          actions={
            <div className="actions actions--inline">
              <button className="btn" onClick={saveSleep} disabled={sleepLoading || sleepSaving}>
                {sleepSaving ? 'Saving…' : 'Save sleep settings'}
              </button>
              <button className="btn btn--secondary" onClick={refreshSleepStatus} disabled={sleepLoading}>
                Refresh status
              </button>
              <button className="btn btn--ghost" onClick={loadSleep} disabled={sleepLoading}>
                Reload
              </button>
            </div>
          }
        >
          {sleepError ? <div className="alert alert--error">{sleepError}</div> : null}
          <FormRow label="Sleep Mode">
            <FormToggle
              label="Sleep aktivieren"
              description="Server schlafen lassen, wenn keine Spieler online sind."
              checked={sleepSettings?.sleepEnabled ?? false}
              onChange={(value) => updateSleepField('sleepEnabled', value)}
              disabled={sleepLoading}
            />
          </FormRow>
          <FormRow label="Idle minutes" help="Minuten ohne Spieler, bevor der Server stoppt.">
            <input
              type="number"
              min={1}
              value={sleepSettings?.idleMinutes ?? 15}
              onChange={(event) => updateSleepField('idleMinutes', Number(event.target.value) || 0)}
              disabled={sleepLoading}
            />
          </FormRow>
          <FormRow label="Wake grace" help="Sekunden bis zum Stop nach einem Wake-Signal." >
            <input
              type="number"
              min={10}
              value={sleepSettings?.wakeGraceSeconds ?? 60}
              onChange={(event) => updateSleepField('wakeGraceSeconds', Number(event.target.value) || 0)}
              disabled={sleepLoading}
            />
          </FormRow>
          <FormRow label="Wake on ping">
            <FormToggle
              label="Auf Status-Pings reagieren"
              checked={sleepSettings?.wakeOnPing ?? true}
              onChange={(value) => updateSleepField('wakeOnPing', value)}
              disabled={sleepLoading}
            />
          </FormRow>
          <div className="page__hint">
            <div>Enabled: {sleepSettings?.sleepEnabled ? 'Yes' : 'No'}</div>
            <div>
              Idle for: {formatIdle(sleepStatus?.idleFor)} / Last activity: {formatTimestamp(sleepStatus?.lastActivityAt)}
            </div>
            <div>
              Status: {sleepStatus?.proxyStatus ?? 'unknown'} · Start: {sleepStatus?.startInProgress ? 'starting' : 'idle'} · Stop:{' '}
              {sleepStatus?.stopInProgress ? 'stopping' : 'idle'}
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Backups & Restore"
          description={`Stored at APP_DATA_DIR/backups/${id}. Enthält Welten, Configs und Spielerlisten.`}
        >
          {backupError ? <div className="alert alert--error">{backupError}</div> : null}
          {downloadError ? <div className="alert alert--error">{downloadError}</div> : null}
          <FormRow
            label="Format"
            help="Wähle das Archiv-Format für neue Backups."
            alignTop
          >
            <div className="actions actions--inline" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={backupFormat} onChange={(event) => setBackupFormat(event.target.value as BackupFormat)}>
                <option value="zip">ZIP</option>
                <option value="tar.gz">tar.gz</option>
              </select>
              <button className="btn" onClick={startBackup} disabled={backupsLoading}>
                Create backup
              </button>
              <button className="btn btn--ghost" onClick={loadBackups} disabled={backupsLoading}>
                Refresh list
              </button>
            </div>
          </FormRow>
          {backupJob ? (
            <div className="alert alert--muted">
              Backup job {backupJob.id}: {backupJob.message ?? backupJob.status} ({Math.round(backupJob.progress)}%)
              {backupJob.error ? ` - ${backupJob.error}` : ''}
            </div>
          ) : null}
          {restoreJob ? (
            <div className="alert alert--muted">
              Restore job {restoreJob.id}: {restoreJob.message ?? restoreJob.status} ({Math.round(restoreJob.progress)}%)
              {restoreJob.error ? ` - ${restoreJob.error}` : ''}
            </div>
          ) : null}
          <FormRow label="Restore options" alignTop>
            <div className="form-grid">
              <FormToggle
                label="Force stop before restore"
                checked={restoreOptions.forceStop}
                onChange={(value) => setRestoreOptions((prev) => ({ ...prev, forceStop: value }))}
              />
              <FormToggle
                label="Take snapshot before restore"
                checked={restoreOptions.preRestoreSnapshot}
                onChange={(value) => setRestoreOptions((prev) => ({ ...prev, preRestoreSnapshot: value }))}
              />
              <FormToggle
                label="Auto-start after restore"
                checked={restoreOptions.autoStart}
                onChange={(value) => setRestoreOptions((prev) => ({ ...prev, autoStart: value }))}
              />
            </div>
          </FormRow>
          {backupsLoading ? (
            <div className="alert alert--muted">Loading backups…</div>
          ) : backups.length === 0 ? (
            <div className="alert alert--muted">No backups yet.</div>
          ) : (
            <div className="table" style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Created</th>
                    <th>Size</th>
                    <th>Format</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr key={backup.id}>
                      <td>{backup.name}</td>
                      <td>{formatTimestamp(backup.createdAt)}</td>
                      <td>{formatBytes(backup.size)}</td>
                      <td>{backup.format}</td>
                      <td className="actions actions--inline">
                        <button className="btn btn--ghost" onClick={() => handleDownloadBackup(backup.id)}>
                          Download
                        </button>
                        <button
                          className="btn btn--secondary"
                          onClick={() => handleRestore(backup.id)}
                          disabled={restoreInFlight === backup.id}
                        >
                          {restoreInFlight === backup.id ? 'Restoring…' : 'Restore'}
                        </button>
                        <button className="btn btn--ghost" onClick={() => handleDeleteBackup(backup.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>
      </div>
    </section>
  )
}

export default SettingsPage
