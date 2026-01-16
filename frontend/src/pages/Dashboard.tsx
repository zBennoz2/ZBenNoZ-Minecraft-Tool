import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import BackButton from '../components/BackButton'
import {
  CreateInstancePayload,
  HytaleInstallMode,
  Instance,
  InstanceMetrics,
  InstanceStatus,
  LoaderType,
  ServerType,
  createInstance,
  getCatalogVersions,
  getInstanceMetrics,
  getInstanceStatus,
  listInstances,
  restartInstance,
  startInstance,
  stopInstance,
} from '../api'

const formatGigabytes = (bytes?: number | null) => {
  if (!bytes || Number.isNaN(bytes)) return '—'
  const gb = bytes / (1024 * 1024 * 1024)
  return gb.toFixed(gb >= 10 ? 0 : 1)
}

type CreateGame = '' | 'minecraft' | 'hytale'

type ActionType = 'start' | 'stop' | 'restart'

interface ActionState {
  id: string
  type: ActionType
}

const GAME_TEMPLATES = {
  minecraft: {
    label: 'Minecraft Java',
    description: 'Choose Paper/Fabric/Forge and your Minecraft version.',
    serverTypes: [
      { value: 'vanilla', label: 'Vanilla' },
      { value: 'paper', label: 'Paper' },
      { value: 'fabric', label: 'Fabric' },
      { value: 'forge', label: 'Forge' },
      { value: 'neoforge', label: 'NeoForge' },
    ] as { value: ServerType; label: string }[],
  },
  hytale: {
    label: 'Hytale',
    description: 'Prepare the Hytale server with the official downloader or import files.',
    serverTypes: [{ value: 'hytale', label: 'Hytale' }] as { value: ServerType; label: string }[],
  },
}

export function Dashboard() {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<ActionState | null>(null)
  const [statusByInstanceId, setStatusByInstanceId] = useState<
    Record<string, InstanceStatus>
  >({})
  const [metricsByInstanceId, setMetricsByInstanceId] = useState<
    Record<string, InstanceMetrics>
  >({})
  const [metricsErrorByInstanceId, setMetricsErrorByInstanceId] = useState<
    Record<string, string>
  >({})
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [createName, setCreateName] = useState('')
  const [createGame, setCreateGame] = useState<CreateGame>('')
  const [createServerType, setCreateServerType] = useState<ServerType | null>(null)
  const [minecraftVersion, setMinecraftVersion] = useState('')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [hytaleInstallMode, setHytaleInstallMode] = useState<HytaleInstallMode>('downloader')
  const [hytaleDownloaderUrl, setHytaleDownloaderUrl] = useState('')
  const [hytaleImportServerPath, setHytaleImportServerPath] = useState('')
  const [hytaleImportAssetsPath, setHytaleImportAssetsPath] = useState('')
  const [loaderOptions, setLoaderOptions] = useState<string[]>([])
  const [loaderVersionsByMinecraft, setLoaderVersionsByMinecraft] = useState<
    Record<string, string[]>
  >({})
  const [catalogVersions, setCatalogVersions] = useState<string[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const isBusy = Boolean(activeAction)

  const isHytale = createGame === 'hytale'
  const requiresLoader =
    createGame === 'minecraft' &&
    Boolean(createServerType) &&
    ['fabric', 'forge', 'neoforge'].includes(createServerType ?? '')
  const showLoaderSelect = requiresLoader && loaderOptions.length > 0

  const loaderType = useMemo(() => {
    if (createServerType === 'fabric') return 'fabric'
    if (createServerType === 'forge' || createServerType === 'neoforge') return 'forge'
    return undefined
  }, [createServerType])

  const fetchInstances = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listInstances()
      setInstances(result)
      const ids = result.map((instance) => instance.id)
      await Promise.all(ids.map((instanceId) => refreshInstanceStatus(instanceId)))
      await Promise.all(ids.map((instanceId) => refreshInstanceMetrics(instanceId)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load instances'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const refreshInstanceStatus = async (instanceId: string) => {
    try {
      const status = await getInstanceStatus(instanceId)
      setStatusByInstanceId((prev) => ({ ...prev, [instanceId]: status }))
    } catch (err) {
      console.error('Failed to fetch instance status', err)
    }
  }

  const refreshInstanceMetrics = async (instanceId: string) => {
    const controller = new AbortController()
    try {
      const metrics = await getInstanceMetrics(instanceId, { signal: controller.signal })
      setMetricsByInstanceId((prev) => ({ ...prev, [instanceId]: metrics }))
      setMetricsErrorByInstanceId((prev) => ({ ...prev, [instanceId]: '' }))
      setStatusByInstanceId((prev) => ({ ...prev, [instanceId]: { status: metrics.status, pid: metrics.pid } }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Metrics unavailable'
      setMetricsErrorByInstanceId((prev) => ({ ...prev, [instanceId]: message }))
    }
  }

  const handleAction = async (id: string, type: ActionType) => {
    if (isBusy) return
    setActiveAction({ id, type })
    try {
      if (type === 'start') {
        await startInstance(id)
      } else if (type === 'stop') {
        await stopInstance(id)
      } else {
        await restartInstance(id)
      }
      await refreshInstanceStatus(id)
      await refreshInstanceMetrics(id)
    } catch (err) {
      console.error('Failed to run action', err)
    } finally {
      setActiveAction(null)
    }
  }

  const handleOpenCreate = () => {
    setIsCreateOpen(true)
    setCreateError(null)
  }

  const loadCatalog = async (serverType: ServerType) => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const result = await getCatalogVersions(serverType)
      setCatalogVersions(result.versions ?? [])
      setLoaderVersionsByMinecraft(result.loaderVersionsByMinecraft ?? {})
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load catalog'
      setCatalogError(message)
      setCatalogVersions([])
      setLoaderVersionsByMinecraft({})
    } finally {
      setCatalogLoading(false)
    }
  }

  const handleCreateInstance = async (event: FormEvent) => {
    event.preventDefault()
    if (!createServerType) {
      setCreateError('Bitte Server-Typ auswählen')
      return
    }
    setCreating(true)
    setCreateError(null)

    try {
      const payload: CreateInstancePayload = {
        name: createName.trim(),
        serverType: createServerType,
        minecraftVersion: minecraftVersion || undefined,
      }

      if (createGame === 'hytale') {
        payload.hytale = {
          install: {
            mode: hytaleInstallMode,
            downloaderUrl: hytaleDownloaderUrl || undefined,
            importServerPath: hytaleImportServerPath || undefined,
            importAssetsPath: hytaleImportAssetsPath || undefined,
          },
        }
      }

      if (requiresLoader && loaderType) {
        const resolvedLoaderVersion = loaderVersion || (!showLoaderSelect ? minecraftVersion : '')
        if (resolvedLoaderVersion) {
          payload.loader = {
            type: loaderType as LoaderType,
            version: resolvedLoaderVersion,
          }
        }
      }

      const created = await createInstance(payload)
      setCreateName('')
      setCreateGame('')
      setCreateServerType(null)
      setMinecraftVersion('')
      setLoaderVersion('')
      setIsCreateOpen(false)
      setInstances((prev) => [created, ...prev])
      await refreshInstanceStatus(created.id)
      await refreshInstanceMetrics(created.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create instance'
      setCreateError(message)
    } finally {
      setCreating(false)
    }
  }

  const createDisabled =
    creating ||
    !createName.trim() ||
    !createGame ||
    !createServerType ||
    (createGame === 'minecraft' && !minecraftVersion) ||
    (showLoaderSelect && !loaderVersion) ||
    (createGame === 'hytale' &&
      hytaleInstallMode === 'import' &&
      (!hytaleImportServerPath || !hytaleImportAssetsPath))

  useEffect(() => {
    fetchInstances()
  }, [])

  useEffect(() => {
    if (!createServerType || createGame !== 'minecraft') {
      setCatalogVersions([])
      setLoaderOptions([])
      setLoaderVersionsByMinecraft({})
      setCatalogError(null)
      return
    }
    void loadCatalog(createServerType)
  }, [createServerType, createGame])

  useEffect(() => {
    if (!requiresLoader) {
      setLoaderOptions([])
      return
    }
    if (minecraftVersion && loaderVersionsByMinecraft[minecraftVersion]) {
      setLoaderOptions(loaderVersionsByMinecraft[minecraftVersion])
      setLoaderVersion('')
    }
  }, [loaderVersionsByMinecraft, minecraftVersion, requiresLoader])

  useEffect(() => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current)
    }

    const pollStatuses = () => {
      const ids = instances.map((instance) => instance.id)
      ids.forEach((instanceId) => {
        refreshInstanceStatus(instanceId)
        refreshInstanceMetrics(instanceId)
      })
    }

    if (instances.length > 0) {
      pollerRef.current = setInterval(pollStatuses, 4000)
    }

    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current)
        pollerRef.current = null
      }
    }
  }, [instances])

  return (
    <section className="page">
      <div className="page__toolbar">
        <BackButton />
      </div>
      <div className="page__header page__header--spread">
        <div>
          <h1>Dashboard</h1>
          <p className="page__hint">Server overview & quick controls</p>
        </div>
        <div className="actions">
          <button className="btn btn--ghost" onClick={fetchInstances} disabled={loading}>
            {loading ? 'Reloading…' : 'Reload'}
          </button>
          <button className="btn" onClick={handleOpenCreate}>
            Create Instance
          </button>
        </div>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {loading ? <div className="alert alert--muted">Loading instances…</div> : null}

      {!loading && instances.length === 0 && !error ? (
        <div className="empty">No instances found.</div>
      ) : null}

      <div className="instance-grid instance-grid--compact">
        {instances.map((instance) => {
          const metrics = metricsByInstanceId[instance.id]
          const metricsError = metricsErrorByInstanceId[instance.id]
          const status = metrics?.status ?? statusByInstanceId[instance.id]?.status ?? 'unknown'
          const isRunning = status === 'running'
          const isStarting = status === 'starting'
          const isActive = activeAction?.id === instance.id
          const cpuValue = isRunning ? metrics?.cpuPercent ?? 0 : null
          const memoryBytes = isRunning ? metrics?.memoryBytes ?? null : null
          const memoryLimitBytes = metrics?.memoryLimitBytes ?? null
          const playersOnline =
            metrics?.onlinePlayers ??
            metrics?.playersOnline ??
            (isRunning ? null : 0)
          const playersText = playersOnline === null ? '—' : `${playersOnline}`

          const showRunActions = status === 'running'
          const startDisabled = isBusy || isStarting || status === 'running'
          const stopDisabled = isBusy || status !== 'running'
          const restartDisabled = isBusy || status !== 'running'

          return (
            <article key={instance.id} className="instance-tile">
              <header className="instance-tile__header">
                <div className="instance-tile__title-wrap">
                  <h2 className="instance-tile__title" title={instance.name}>
                    {instance.name}
                  </h2>
                  <div className="instance-tile__meta" title={`${instance.id} • ${instance.serverType}`}>
                    {instance.id} • {instance.serverType}
                  </div>
                </div>
                <span className={`badge badge--${status}`}>{status}</span>
              </header>

              <div className="instance-tile__metrics">
                <div className="instance-tile__metric">
                  <span>CPU</span>
                  <strong>{cpuValue === null ? '—' : `${cpuValue.toFixed(1)}%`}</strong>
                </div>
                <div className="instance-tile__metric">
                  <span>RAM</span>
                  <strong>
                    {memoryBytes === null
                      ? '—'
                      : `${formatGigabytes(memoryBytes)}${
                          memoryLimitBytes ? ` / ${formatGigabytes(memoryLimitBytes)}` : ''
                        } GB`}
                  </strong>
                </div>
                <div className="instance-tile__metric">
                  <span>Spieler</span>
                  <strong>{playersText}</strong>
                </div>
              </div>

              {metricsError ? (
                <div className="instance-tile__warning" title={metricsError}>
                  Metrics unavailable
                </div>
              ) : null}

              <div className="instance-tile__actions">
                <Link
                  className="btn btn--ghost"
                  to={`/instances/${instance.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Instanz öffnen
                </Link>
                {showRunActions ? (
                  <>
                    <button
                      className="btn btn--secondary"
                      disabled={stopDisabled}
                      onClick={() => handleAction(instance.id, 'stop')}
                    >
                      {isActive && activeAction?.type === 'stop' ? 'Stopping…' : 'Stop'}
                    </button>
                    <button
                      className="btn"
                      disabled={restartDisabled}
                      onClick={() => handleAction(instance.id, 'restart')}
                    >
                      {isActive && activeAction?.type === 'restart' ? 'Restarting…' : 'Neustart'}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn"
                    disabled={startDisabled}
                    onClick={() => handleAction(instance.id, 'start')}
                  >
                    {isActive && activeAction?.type === 'start' ? 'Starting…' : 'Start'}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsCreateOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div>
                <h2>Create Instance</h2>
                <p className="page__hint">Spin up a new server quickly</p>
              </div>
              <button className="btn btn--ghost" onClick={() => setIsCreateOpen(false)}>
                Close
              </button>
            </div>

            <form className="form" onSubmit={handleCreateInstance}>
              <label className="form__field">
                <span>Name *</span>
                <input
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="My new server"
                  required
                />
              </label>

              <label className="form__field">
                <span>Game *</span>
                <select
                  value={createGame}
                  onChange={(event) => {
                    const value = event.target.value as CreateGame
                    setCreateGame(value)
                    setMinecraftVersion('')
                    setLoaderVersion('')
                    if (value === 'hytale') {
                      setCreateServerType('hytale')
                      setHytaleInstallMode('downloader')
                      setHytaleDownloaderUrl('')
                      setHytaleImportServerPath('')
                      setHytaleImportAssetsPath('')
                    } else {
                      setCreateServerType(null)
                    }
                    setCreateError(null)
                  }}
                  required
                >
                  <option value="" disabled>
                    Select a game
                  </option>
                  <option value="minecraft">{GAME_TEMPLATES.minecraft.label}</option>
                  <option value="hytale">{GAME_TEMPLATES.hytale.label}</option>
                </select>
                {createGame ? (
                  <small className="page__hint">{GAME_TEMPLATES[createGame].description}</small>
                ) : null}
              </label>

              <div className="form__inline">
                {createGame === 'minecraft' ? (
                  <label className="form__field">
                    <span>Server Type *</span>
                    <select
                      value={createServerType ?? ''}
                      onChange={(event) => {
                        const value = event.target.value as ServerType | ''
                        setCreateServerType(value || null)
                        setMinecraftVersion('')
                        setLoaderVersion('')
                        setCreateError(null)
                      }}
                      required
                    >
                      <option value="" disabled>
                        Select a type
                      </option>
                      {GAME_TEMPLATES.minecraft.serverTypes.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {createGame === 'minecraft' ? (
                  <label className="form__field">
                    <span>Minecraft Version *</span>
                    <select
                      value={minecraftVersion}
                      onChange={(event) => {
                        setMinecraftVersion(event.target.value)
                        setLoaderVersion('')
                      }}
                      disabled={!createServerType || catalogLoading}
                      required
                    >
                      <option value="" disabled>
                        {createServerType
                          ? catalogLoading
                            ? 'Loading versions…'
                            : 'Select version'
                          : 'Choose server type first'}
                      </option>
                      {catalogVersions.map((version) => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : createGame === 'hytale' ? (
                  <div className="alert alert--muted">
                    Hytale requires Java 25 and uses the default UDP port 5520. Configure additional settings after creation.
                  </div>
                ) : null}
              </div>

              {isHytale ? (
                <>
                  <label className="form__field">
                    <span>Install Mode *</span>
                    <select
                      value={hytaleInstallMode}
                      onChange={(event) =>
                        setHytaleInstallMode(event.target.value as HytaleInstallMode)
                      }
                      required
                    >
                      <option value="downloader">Downloader CLI (recommended)</option>
                      <option value="import">Import existing files</option>
                    </select>
                  </label>

                  {hytaleInstallMode === 'downloader' ? (
                    <label className="form__field">
                      <span>Downloader URL (optional)</span>
                      <input
                        type="text"
                        value={hytaleDownloaderUrl}
                        onChange={(event) => setHytaleDownloaderUrl(event.target.value)}
                        placeholder="https://example.com/hytale-downloader.zip"
                      />
                    </label>
                  ) : (
                    <div className="form__inline">
                      <label className="form__field">
                        <span>Server Folder Path *</span>
                        <input
                          type="text"
                          value={hytaleImportServerPath}
                          onChange={(event) => setHytaleImportServerPath(event.target.value)}
                          placeholder="/path/to/Server"
                          required
                        />
                      </label>
                      <label className="form__field">
                        <span>Assets.zip Path *</span>
                        <input
                          type="text"
                          value={hytaleImportAssetsPath}
                          onChange={(event) => setHytaleImportAssetsPath(event.target.value)}
                          placeholder="/path/to/Assets.zip"
                          required
                        />
                      </label>
                    </div>
                  )}
                </>
              ) : null}

              {showLoaderSelect ? (
                <label className="form__field">
                  <span>Loader Version *</span>
                  <select
                    value={loaderVersion}
                    onChange={(event) => setLoaderVersion(event.target.value)}
                    disabled={!minecraftVersion}
                    required={showLoaderSelect}
                  >
                    <option value="" disabled>
                      {minecraftVersion ? 'Select loader version' : 'Pick a Minecraft version first'}
                    </option>
                    {loaderOptions.map((version) => (
                      <option key={version} value={version}>
                        {version}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {catalogLoading ? <div className="alert alert--muted">Loading catalog…</div> : null}
              {catalogError ? <div className="alert alert--error">{catalogError}</div> : null}
              {createError ? <div className="alert alert--error">{createError}</div> : null}

              <div className="actions">
                <button type="button" className="btn btn--ghost" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={createDisabled}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default Dashboard
