import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import BackButton from '../components/BackButton'
import {
  CreateInstancePayload,
  HytaleInstallMode,
  Instance,
  InstanceMetrics,
  InstanceStatus,
  JavaCandidate,
  JavaRequirement,
  LoaderType,
  PrepareInstanceOptions,
  ServerType,
  createInstance,
  getCatalogVersions,
  getInstanceMetrics,
  getInstanceStatus,
  installJava,
  listInstances,
  prepareInstance,
  startInstance,
  stopInstance,
  streamJavaInstall,
} from '../api'
import { formatJavaCandidateList, formatJavaRequirement } from '../utils/javaRequirement'

type PrepareState = 'not_prepared' | 'preparing' | 'prepared' | 'error'

type CreateGame = '' | 'minecraft' | 'hytale'

type JavaInstallStatus = 'idle' | 'installing' | 'done' | 'error'

interface JavaInstallState {
  status: JavaInstallStatus
  major: number
  progress?: number
  message?: string
}

interface JavaRequirementIssue {
  requirement?: JavaRequirement
  candidates?: JavaCandidate[]
  reasons?: string[]
}

interface JavaInstallEvent {
  jobId: string
  phase: 'download' | 'extract' | 'verify' | 'done' | 'error'
  progress: number
  message?: string
  javaPath?: string
}

interface ActionState {
  id: string
  type: 'start' | 'stop'
}

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex] ?? 'B'}`
}

const formatDuration = (ms: number | null | undefined) => {
  if (!ms) return '—'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

const clampPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}

const MiniSparkline = ({ values, title }: { values?: number[]; title: string }) => {
  if (!values || values.length < 2) {
    return <div className="sparkline sparkline--empty">—</div>
  }

  const points = values.slice(-60)
  const width = 120
  const height = 32
  const step = width / Math.max(points.length - 1, 1)
  const pathD = points
    .map((value, index) => {
      const x = index * step
      const y = height - (clampPercent(value) / 100) * height
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <title>{title}</title>
      <path d={pathD} />
    </svg>
  )
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
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)

  const [createName, setCreateName] = useState('')
  const [createGame, setCreateGame] = useState<CreateGame>('')
  const [createServerType, setCreateServerType] = useState<ServerType | ''>('')
  const [minecraftVersion, setMinecraftVersion] = useState('')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [hytaleInstallMode, setHytaleInstallMode] = useState<HytaleInstallMode>('downloader')
  const [hytaleDownloaderUrl, setHytaleDownloaderUrl] = useState('')
  const [hytaleImportServerPath, setHytaleImportServerPath] = useState('')
  const [hytaleImportAssetsPath, setHytaleImportAssetsPath] = useState('')
  const [loaderOptions, setLoaderOptions] = useState<string[]>([])
  const [catalogVersions, setCatalogVersions] = useState<string[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [loaderVersionsByMinecraft, setLoaderVersionsByMinecraft] = useState<
    Record<string, string[]>
  >({})
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [prepareStateByInstanceId, setPrepareStateByInstanceId] = useState<
    Record<string, PrepareState>
  >({})
  const [prepareMessageByInstanceId, setPrepareMessageByInstanceId] = useState<
    Record<string, string | undefined>
  >({})
  const [prepareJavaIssueByInstanceId, setPrepareJavaIssueByInstanceId] = useState<
    Record<string, JavaRequirementIssue | undefined>
  >({})
  const [javaInstallByInstanceId, setJavaInstallByInstanceId] = useState<
    Record<string, JavaInstallState | undefined>
  >({})
  const javaInstallStreamRef = useRef<Record<string, EventSource>>({})
  const [metricsByInstanceId, setMetricsByInstanceId] = useState<
    Record<string, InstanceMetrics>
  >({})
  const [metricsErrorByInstanceId, setMetricsErrorByInstanceId] = useState<
    Record<string, string>
  >({})
  const metricsControllersRef = useRef<Record<string, AbortController>>({})
  const [metricsHistoryByInstanceId, setMetricsHistoryByInstanceId] = useState<
    Record<string, { cpu: number[]; memory: number[] }>
  >({})
  const [cardDensity, setCardDensity] = useState<'comfortable' | 'compact'>(
    'comfortable',
  )

  const isBusy = useMemo(() => loading || Boolean(activeAction), [loading, activeAction])
  const isHytale = createServerType === 'hytale'
  const usesCatalog = createGame === 'minecraft' && Boolean(createServerType) && !isHytale

  const requiresLoader = useMemo(
    () =>
      createServerType === 'fabric' ||
      createServerType === 'forge' ||
      createServerType === 'neoforge',
    [createServerType],
  )
  const showLoaderSelect = useMemo(
    () =>
      requiresLoader &&
      (loaderOptions.length > 0 || Object.keys(loaderVersionsByMinecraft).length > 0),
    [loaderOptions.length, loaderVersionsByMinecraft, requiresLoader],
  )
  const createDisabled = useMemo(() => {
    if (!createName.trim() || !createGame || !createServerType) return true
    if (!isHytale && !minecraftVersion) return true
    if (isHytale && hytaleInstallMode === 'import') {
      if (!hytaleImportServerPath.trim() || !hytaleImportAssetsPath.trim()) return true
    }
    if (showLoaderSelect && !loaderVersion) return true
    return creating
  }, [
    createName,
    createGame,
    createServerType,
    creating,
    hytaleImportAssetsPath,
    hytaleImportServerPath,
    hytaleInstallMode,
    isHytale,
    loaderVersion,
    minecraftVersion,
    showLoaderSelect,
  ])

  const runningCount = useMemo(
    () => instances.filter((instance) => statusByInstanceId[instance.id]?.status === 'running').length,
    [instances, statusByInstanceId],
  )

  const preparedCount = useMemo(
    () =>
      instances.filter((instance) => {
        const state = prepareStateByInstanceId[instance.id] ?? 'prepared'
        return state === 'prepared'
      }).length,
    [instances, prepareStateByInstanceId],
  )

  const totalPlayers = useMemo(
    () =>
      instances.reduce((total, instance) => {
        const metrics = metricsByInstanceId[instance.id]
        const onlinePlayers = metrics?.onlinePlayers ?? metrics?.playersOnline
        if (onlinePlayers && onlinePlayers > 0) {
          return total + onlinePlayers
        }
        return total
      }, 0),
    [instances, metricsByInstanceId],
  )

  const refreshInstanceStatus = async (instanceId: string) => {
    const status = await getInstanceStatus(instanceId)
    setStatusByInstanceId((prev) => ({ ...prev, [instanceId]: status }))
  }

  const updateMetricsHistory = (
    instanceId: string,
    cpuPercent: number | null,
    memoryPercent: number | null,
  ) => {
    const maxPoints = 60
    setMetricsHistoryByInstanceId((prev) => {
      const next = { ...prev }
      const existing = next[instanceId] ?? { cpu: [], memory: [] }
      if (cpuPercent !== null) {
        existing.cpu = [...existing.cpu, clampPercent(cpuPercent)].slice(-maxPoints)
      }
      if (memoryPercent !== null) {
        existing.memory = [...existing.memory, clampPercent(memoryPercent)].slice(-maxPoints)
      }
      next[instanceId] = existing
      return next
    })
  }

  const refreshInstanceMetrics = async (instanceId: string) => {
    if (metricsControllersRef.current[instanceId]) {
      metricsControllersRef.current[instanceId]?.abort()
    }

    const controller = new AbortController()
    metricsControllersRef.current[instanceId] = controller

    try {
      const metrics = await getInstanceMetrics(instanceId, { signal: controller.signal })
      setMetricsByInstanceId((prev) => ({ ...prev, [instanceId]: metrics }))
      setMetricsErrorByInstanceId((prev) => {
        const next = { ...prev }
        delete next[instanceId]
        return next
      })
      setStatusByInstanceId((prev) => ({ ...prev, [instanceId]: { status: metrics.status, pid: metrics.pid } }))

      const memoryPercent =
        metrics.memoryLimitBytes && metrics.memoryLimitBytes > 0 && metrics.memoryBytes !== null
          ? (metrics.memoryBytes / metrics.memoryLimitBytes) * 100
          : null

      updateMetricsHistory(instanceId, metrics.cpuPercent, memoryPercent)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return
      const message = error instanceof Error ? error.message : 'Metrics unavailable'
      setMetricsErrorByInstanceId((prev) => ({ ...prev, [instanceId]: message }))
    }
  }

  const updatePrepareState = (
    instanceId: string,
    state: PrepareState,
    message?: string,
  ) => {
    setPrepareStateByInstanceId((prev) => ({ ...prev, [instanceId]: state }))
    setPrepareMessageByInstanceId((prev) => ({ ...prev, [instanceId]: message }))
  }

  const triggerPrepare = async (instance: Instance) => {
    const prepareOptions: PrepareInstanceOptions = {
      serverType: instance.serverType,
      minecraftVersion: instance.minecraftVersion,
      loader: instance.loader,
    }

    if (instance.serverType === 'hytale') {
      prepareOptions.hytaleInstallMode = instance.hytale?.install?.mode ?? 'downloader'
      prepareOptions.hytaleDownloaderUrl = instance.hytale?.install?.downloaderUrl
      prepareOptions.hytaleImportServerPath = instance.hytale?.install?.importServerPath
      prepareOptions.hytaleImportAssetsPath = instance.hytale?.install?.importAssetsPath
    }

    updatePrepareState(instance.id, 'preparing')
    setPrepareJavaIssueByInstanceId((prev) => ({ ...prev, [instance.id]: undefined }))
    const result = await prepareInstance(instance.id, prepareOptions)

    if (result.success) {
      updatePrepareState(instance.id, 'prepared', result.message)
      setPrepareJavaIssueByInstanceId((prev) => ({ ...prev, [instance.id]: undefined }))
    } else if (result.status === 'needs_java') {
      updatePrepareState(
        instance.id,
        'error',
        result.message ?? 'Java runtime required to prepare this instance.',
      )
      setPrepareJavaIssueByInstanceId((prev) => ({
        ...prev,
        [instance.id]: {
          requirement: result.requirement,
          candidates: result.candidates,
          reasons: result.reasons,
        },
      }))
    } else {
      updatePrepareState(instance.id, 'error', result.message ?? 'Prepare failed')
    }

    await refreshInstanceStatus(instance.id)
  }

  const startJavaInstall = async (instanceId: string, requirement?: JavaRequirement) => {
    if (!requirement) return
    const major = requirement.major
    const existing = javaInstallStreamRef.current[instanceId]
    if (existing) {
      existing.close()
      delete javaInstallStreamRef.current[instanceId]
    }
    setJavaInstallByInstanceId((prev) => ({
      ...prev,
      [instanceId]: { status: 'installing', major, progress: 0, message: 'Starting download…' },
    }))
    try {
      const result = await installJava(major)
      if (result.status === 'already_installed') {
        setJavaInstallByInstanceId((prev) => ({
          ...prev,
          [instanceId]: {
            status: 'done',
            major,
            progress: 100,
            message: `Java ${major} is already installed. Retry prepare.`,
          },
        }))
        return
      }

      const jobId = result.jobId
      if (!jobId) {
        throw new Error('Java install job not started')
      }

      const source = streamJavaInstall(jobId, (event) => {
        try {
          const data = JSON.parse(event.data) as JavaInstallEvent
          setJavaInstallByInstanceId((prev) => ({
            ...prev,
            [instanceId]: {
              status: data.phase === 'error' ? 'error' : data.phase === 'done' ? 'done' : 'installing',
              major,
              progress: data.progress,
              message: data.message ?? `Java install ${data.phase}…`,
            },
          }))
          if (data.phase === 'done' || data.phase === 'error') {
            source.close()
            delete javaInstallStreamRef.current[instanceId]
          }
        } catch (parseError) {
          console.error('Failed to parse Java install event', parseError)
        }
      })
      javaInstallStreamRef.current[instanceId] = source
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Java install'
      setJavaInstallByInstanceId((prev) => ({
        ...prev,
        [instanceId]: { status: 'error', major, message },
      }))
    }
  }

  const buildJavaRequirementMessage = (issue?: JavaRequirementIssue) => {
    const requirementText = formatJavaRequirement(issue?.requirement)
    const candidates = formatJavaCandidateList(issue?.candidates)
    const detail = candidates.join(' ')
    return `Instance requires ${requirementText}. ${detail} Install the required Java or configure the Java path in Settings.`
  }

  const fetchInstances = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listInstances()
      setInstances(result)
      setSelectedInstanceId((prev) => (prev && result.some((r) => r.id === prev) ? prev : null))
      setPrepareStateByInstanceId((prev) => {
        const next = { ...prev }
        result.forEach((instance) => {
          if (!next[instance.id]) {
            next[instance.id] = 'prepared'
          }
        })
        return next
      })
      const ids = result.map((instance) => instance.id)
      await Promise.all(ids.map((instanceId) => refreshInstanceStatus(instanceId)))
      setStatusByInstanceId((prev) => {
        const next = { ...prev }
        ids.forEach((id) => {
          if (!next[id]) {
            next[id] = { status: 'unknown', pid: null }
          }
        })
        return next
      })
      await Promise.all(ids.map((instanceId) => refreshInstanceMetrics(instanceId)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load instances'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (id: string, type: ActionState['type']) => {
    setActiveAction({ id, type })
    setError(null)
    try {
      if (type === 'start') {
        const result = await startInstance(id)
        if (result.status === 'needs_java') {
          setError(
            buildJavaRequirementMessage({
              requirement: result.requirement ?? (result.recommendedMajor ? { major: result.recommendedMajor, mode: 'minimum' } : undefined),
              candidates: result.candidates,
              reasons: result.reasons,
            }),
          )
        } else if (result.status === 'ok') {
          // noop
        }
      } else {
        await stopInstance(id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed'
      setError(message)
      if (
        type === 'start' &&
        /jar not found|server jar|missing server jar/i.test(message)
      ) {
        updatePrepareState(id, 'not_prepared', message)
      }
    } finally {
      await refreshInstanceStatus(id)
      setActiveAction(null)
    }
  }

  useEffect(() => {
    fetchInstances()
  }, [])

  useEffect(() => {
    return () => {
      Object.values(metricsControllersRef.current).forEach((controller) => controller.abort())
      Object.values(javaInstallStreamRef.current).forEach((source) => source.close())
    }
  }, [])

  useEffect(() => {
    if (!createServerType || !usesCatalog) {
      setCatalogVersions([])
      setLoaderOptions([])
      setLoaderVersionsByMinecraft({})
      setCatalogError(null)
      return
    }

    const loadCatalog = async () => {
      setCatalogLoading(true)
      setCatalogError(null)
      try {
        const catalog = await getCatalogVersions(createServerType)
        setCatalogVersions(catalog.versions)
        setLoaderVersionsByMinecraft(catalog.loaderVersionsByMinecraft ?? {})
        if (catalog.loaderVersions) {
          setLoaderOptions(catalog.loaderVersions)
        } else {
          setLoaderOptions([])
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to load catalog versions for selected server type'
        setCatalogError(message)
        setCatalogVersions([])
        setLoaderOptions([])
      } finally {
        setCatalogLoading(false)
      }
    }

    loadCatalog()
  }, [createServerType, usesCatalog])

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

  const handleOpenCreate = () => {
    setIsCreateOpen(true)
    setCreateName('')
    setCreateGame('')
    setCreateServerType('')
    setMinecraftVersion('')
    setLoaderVersion('')
    setHytaleInstallMode('downloader')
    setHytaleDownloaderUrl('')
    setHytaleImportServerPath('')
    setHytaleImportAssetsPath('')
    setLoaderOptions([])
    setCatalogVersions([])
    setCatalogError(null)
    setCreateError(null)
  }

  const handleCreateInstance = async (event: FormEvent) => {
    event.preventDefault()
    if (createDisabled || !createServerType) return

    const trimmedName = createName.trim()
    if (!trimmedName) {
      setCreateError('Name is required')
      return
    }

    const payload: CreateInstancePayload = {
      name: trimmedName,
      serverType: createServerType,
      minecraftVersion: createServerType === 'hytale' ? undefined : minecraftVersion,
    }

    if (createServerType === 'hytale') {
      payload.hytale = {
        install: {
          mode: hytaleInstallMode,
          downloaderUrl: hytaleDownloaderUrl.trim() || undefined,
          importServerPath: hytaleImportServerPath.trim() || undefined,
          importAssetsPath: hytaleImportAssetsPath.trim() || undefined,
        },
      }
    }

    if (requiresLoader) {
      const loaderType = createServerType as LoaderType
      const loaderVersionToUse = loaderVersion || (!showLoaderSelect ? minecraftVersion : '')
      if (loaderVersionToUse) {
        payload.loader = { type: loaderType, version: loaderVersionToUse }
      }
    }

    setCreating(true)
    setCreateError(null)

    try {
      const created = await createInstance(payload)
    setIsCreateOpen(false)
    setSelectedInstanceId(created.id)
    setCreateName('')
    setCreateGame('')
    setCreateServerType('')
      setMinecraftVersion('')
      setLoaderVersion('')
      setHytaleInstallMode('downloader')
      setHytaleDownloaderUrl('')
      setHytaleImportServerPath('')
      setHytaleImportAssetsPath('')
      updatePrepareState(created.id, 'preparing')
      await fetchInstances()
      await refreshInstanceStatus(created.id)
      await triggerPrepare(created)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create instance'
      setCreateError(message)
    } finally {
      setCreating(false)
    }
  }

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
          <div className="toggle" role="group" aria-label="Density toggle">
            <button
              type="button"
              className={cardDensity === 'comfortable' ? 'active' : ''}
              onClick={() => setCardDensity('comfortable')}
            >
              Comfortable
            </button>
            <button
              type="button"
              className={cardDensity === 'compact' ? 'active' : ''}
              onClick={() => setCardDensity('compact')}
            >
              Compact
            </button>
          </div>
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

      <div className="metrics-grid">
        <div className="metrics-card">
          <span className="metrics-card__label">Total Instances</span>
          <div className="metrics-card__value">{instances.length}</div>
          <p className="page__hint">Active overview widgets stay balanced.</p>
        </div>
        <div className="metrics-card">
          <span className="metrics-card__label">Running</span>
          <div className="metrics-card__value">{runningCount}</div>
          <p className="page__hint">Quickly spot what is live.</p>
        </div>
        <div className="metrics-card">
          <span className="metrics-card__label">Players Online</span>
          <div className="metrics-card__value">{totalPlayers}</div>
          <p className="page__hint">Summed from available metrics.</p>
        </div>
        <div className="metrics-card">
          <span className="metrics-card__label">Prepared</span>
          <div className="metrics-card__value">{preparedCount}</div>
          <p className="page__hint">Ready for quick starts.</p>
        </div>
      </div>

      {!loading && instances.length === 0 && !error ? (
        <div className="empty">No instances found.</div>
      ) : null}

      <div className={`instance-grid${cardDensity === 'compact' ? ' instance-grid--compact' : ''}`}>
        {instances.map((instance) => {
          const isActive = activeAction?.id === instance.id
          const status = statusByInstanceId[instance.id]?.status ?? 'unknown'
          const metrics = metricsByInstanceId[instance.id]
          const metricsError = metricsErrorByInstanceId[instance.id]
          const displayStatus = metrics?.status ?? status
          const badgeStatus = displayStatus !== 'unknown' ? displayStatus : undefined
          const isSelected = selectedInstanceId === instance.id
          const prepareState = prepareStateByInstanceId[instance.id] ?? 'prepared'
          const prepareMessage = prepareMessageByInstanceId[instance.id]
          const startDisabled =
            isBusy || displayStatus === 'running' || prepareState !== 'prepared'
          const prepareDisabled = isBusy || prepareState === 'preparing'
          const isRunning = displayStatus === 'running' || displayStatus === 'starting'
          const cpuPercent = isRunning ? metrics?.cpuPercent ?? 0 : 0
          const memoryBytes = isRunning ? metrics?.memoryBytes ?? 0 : 0
          const memoryLimitBytes = metrics?.memoryLimitBytes ?? null
          const memoryPercent =
            memoryLimitBytes && memoryLimitBytes > 0
              ? clampPercent((memoryBytes / memoryLimitBytes) * 100)
              : 0
          const playersOnline =
            metrics?.onlinePlayers ??
            metrics?.playersOnline ??
            (displayStatus === 'running' ? null : 0)
          const playersMax = metrics?.maxPlayers ?? metrics?.playersMax ?? null
          const playersTooltip =
            playersOnline === null
              ? `Players unavailable (source: ${metrics?.playersSource ?? 'unavailable'})`
              : undefined
          const uptimeDisplay = isRunning ? formatDuration(metrics?.uptimeMs) : '—'
          const metricsUnavailable = Boolean(metricsError) || metrics?.metricsAvailable === false
          const highRam = memoryLimitBytes ? memoryPercent > 85 : false
          const highCpu = cpuPercent > 90
          return (
            <article
              key={instance.id}
              className={`instance-card${isSelected ? ' instance-card--selected' : ''}${cardDensity === 'compact' ? ' instance-card--compact' : ''}`}
            >
              <header className="instance-card__header">
                <div>
                  <h2 className="instance-card__title">{instance.name}</h2>
                  <p className="instance-card__meta">ID: {instance.id}</p>
                </div>
                {badgeStatus ? (
                  <span className={`badge badge--${badgeStatus}`}>{badgeStatus}</span>
                ) : null}
              </header>

              <dl className="instance-card__details">
                <div className="instance-card__detail">
                  <dt>Server Type</dt>
                  <dd>{instance.serverType}</dd>
                </div>
                {instance.serverType !== 'hytale' ? (
                  <div className="instance-card__detail">
                    <dt>Minecraft Version</dt>
                    <dd>{instance.minecraftVersion ?? '—'}</dd>
                  </div>
                ) : null}
                {instance.loader?.version ? (
                  <div className="instance-card__detail">
                    <dt>Loader</dt>
                    <dd>{`${instance.loader.type ?? 'loader'} ${instance.loader.version}`}</dd>
                  </div>
                ) : null}
                <div className="instance-card__detail">
                  <dt>Status</dt>
                  <dd>{displayStatus ?? 'unknown'}</dd>
                </div>
                <div className="instance-card__detail">
                  <dt>Port</dt>
                  <dd>
                    {instance.serverPort ?? '—'}
                    {instance.serverType === 'hytale' && instance.serverPort ? ' (UDP)' : null}
                  </dd>
                </div>
                <div className="instance-card__detail">
                  <dt>Preparation</dt>
                  <dd>
                    {prepareState === 'prepared'
                      ? 'Prepared'
                      : prepareState === 'preparing'
                        ? 'Preparing…'
                        : prepareState === 'error'
                          ? 'Error'
                          : 'Not prepared'}
                  </dd>
                </div>
              </dl>

              <div className={`metrics${!isRunning ? ' metrics--muted' : ''}`}>
                <div className="metric">
                  <div className="metric__label">CPU</div>
                  <div className="metric__value">
                    {`${clampPercent(cpuPercent).toFixed(1)}%`}
                    {highCpu ? <span className="badge badge--warning">High CPU</span> : null}
                  </div>
                  <div className="progress">
                    <div className="progress__fill" style={{ width: `${clampPercent(cpuPercent)}%` }} />
                  </div>
                  <MiniSparkline values={metricsHistoryByInstanceId[instance.id]?.cpu} title="CPU trend" />
                </div>

                <div className="metric">
                  <div className="metric__label">RAM</div>
                  <div className="metric__value">
                    {`${formatBytes(memoryBytes)}${
                      memoryLimitBytes ? ` / ${formatBytes(memoryLimitBytes)}` : ''
                    }`}
                    {highRam ? <span className="badge badge--warning">High RAM</span> : null}
                  </div>
                  <div className="progress">
                    <div className="progress__fill" style={{ width: `${memoryLimitBytes ? memoryPercent : 0}%` }} />
                  </div>
                  <MiniSparkline
                    values={metricsHistoryByInstanceId[instance.id]?.memory}
                    title="RAM trend"
                  />
                </div>

                <div className="metric metric--compact">
                  <div className="metric__label">Players</div>
                  <div className="metric__value" title={playersTooltip}>
                    {playersOnline === null ? '—' : playersOnline}/{playersMax ?? '—'}
                  </div>
                  <div className="metric__label">Uptime</div>
                  <div className="metric__value">{uptimeDisplay}</div>
                  {metricsUnavailable ? (
                    <span className="badge badge--muted">metrics unavailable</span>
                  ) : null}
                </div>
              </div>

              <div className="instance-card__actions">
                <button
                  className="btn"
                  disabled={startDisabled}
                  onClick={() => handleAction(instance.id, 'start')}
                >
                  {isActive && activeAction?.type === 'start'
                    ? 'Starting…'
                    : 'Start'}
                </button>
                <button
                  className="btn btn--secondary"
                  disabled={isBusy || displayStatus === 'stopped' || displayStatus === 'unknown'}
                  onClick={() => handleAction(instance.id, 'stop')}
                >
                  {isActive && activeAction?.type === 'stop' ? 'Stopping…' : 'Stop'}
                </button>
                {prepareState !== 'prepared' ? (
                  <button
                    className="btn btn--ghost"
                    disabled={prepareDisabled}
                    onClick={() => triggerPrepare(instance)}
                  >
                    {prepareState === 'preparing' ? 'Preparing…' : 'Prepare'}
                  </button>
                ) : null}
              </div>

              {prepareState === 'preparing' ? (
                <div className="alert alert--muted">Preparing server files…</div>
              ) : null}
              {prepareState === 'error' || prepareState === 'not_prepared' ? (
                <div className="alert alert--error">
                  {prepareMessage ?? 'Server files are not prepared.'}
                  {prepareJavaIssueByInstanceId[instance.id] ? (
                    <div style={{ marginTop: 8 }}>
                      <div>
                        {formatJavaRequirement(prepareJavaIssueByInstanceId[instance.id]?.requirement)} is required
                        for this instance.
                      </div>
                      <ul>
                        {formatJavaCandidateList(prepareJavaIssueByInstanceId[instance.id]?.candidates).map(
                          (line) => (
                            <li key={line}>{line}</li>
                          ),
                        )}
                      </ul>
                      <div className="page__hint">
                        Install the required Java version or set a Java Path in{' '}
                        <Link to={`/instances/${instance.id}/settings`}>Settings</Link>. After installation, retry
                        prepare. Manual downloads are available at{' '}
                        <a
                          href={`https://adoptium.net/temurin/releases/?version=${prepareJavaIssueByInstanceId[instance.id]?.requirement?.major}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Adoptium Temurin releases
                        </a>
                        .
                      </div>
                      <div className="actions actions--inline" style={{ marginTop: 8 }}>
                        <button
                          className="btn btn--secondary"
                          onClick={() =>
                            startJavaInstall(instance.id, prepareJavaIssueByInstanceId[instance.id]?.requirement)
                          }
                          disabled={javaInstallByInstanceId[instance.id]?.status === 'installing'}
                        >
                          {javaInstallByInstanceId[instance.id]?.status === 'installing'
                            ? 'Installing…'
                            : `Install ${formatJavaRequirement(prepareJavaIssueByInstanceId[instance.id]?.requirement)}`}
                        </button>
                        {javaInstallByInstanceId[instance.id]?.message ? (
                          <span className="page__hint">{javaInstallByInstanceId[instance.id]?.message}</span>
                        ) : null}
                      </div>
                      {javaInstallByInstanceId[instance.id]?.status === 'error' ? (
                        <div className="page__hint" style={{ marginTop: 6 }}>
                          If the download keeps failing, set the Java Path in{' '}
                          <Link to={`/instances/${instance.id}/settings`}>Settings</Link> or install Java{' '}
                          {prepareJavaIssueByInstanceId[instance.id]?.requirement?.major} manually from the
                          Adoptium site.
                        </div>
                      ) : null}
                      {javaInstallByInstanceId[instance.id]?.status === 'installing' ? (
                        <div className="page__hint">
                          Progress: {javaInstallByInstanceId[instance.id]?.progress ?? 0}%
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="actions actions--inline">
                    <button
                      className="btn"
                      disabled={prepareDisabled}
                      onClick={() => triggerPrepare(instance)}
                    >
                      Retry Prepare
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="instance-card__links">
                <Link to={`/instances/${instance.id}/console`}>Console</Link>
                <Link to={`/instances/${instance.id}/files`}>Files</Link>
                <Link to={`/instances/${instance.id}/properties`}>Properties</Link>
                <Link to={`/instances/${instance.id}/whitelist`}>Whitelist</Link>
                <Link to={`/instances/${instance.id}/tasks`}>Scheduled Tasks</Link>
                <Link to={`/instances/${instance.id}/settings`}>Settings</Link>
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
                      setCreateServerType('')
                    }
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
                      value={createServerType}
                      onChange={(event) => {
                        const value = event.target.value as ServerType | ''
                        setCreateServerType(value)
                        setMinecraftVersion('')
                        setLoaderVersion('')
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
