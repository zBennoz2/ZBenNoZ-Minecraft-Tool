import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import {
  Instance,
  InstanceMetrics,
  InstanceStatus,
  JavaCandidate,
  JavaRequirement,
  PrepareEvent,
  PrepareInstanceOptions,
  getInstanceMetrics,
  getInstanceStatus,
  installJava,
  prepareInstance,
  streamJavaInstall,
} from '../api'
import { apiUrl } from '../config'
import { formatJavaCandidateList, formatJavaRequirement } from '../utils/javaRequirement'
import { InstanceDetailContext } from './InstanceDetail'

type PrepareState = 'not_prepared' | 'preparing' | 'prepared' | 'error'

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

interface PrepareRunSnapshot {
  runId?: string
  events: PrepareEvent[]
}

type AuthEventData = {
  userCode?: string
  deviceUrl?: string
  expiresAt?: string
  expiresIn?: number
  interval?: number
  previousUserCode?: string
  codeIssuedAt?: string
  authErrorCode?: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied'
}

type PrepareErrorData = {
  extractPath?: string
  jarCandidates?: string[]
  jarCandidateCount?: number
  topLevelFiles?: string[]
}

const formatGigabytes = (bytes?: number | null) => {
  if (!bytes || Number.isNaN(bytes)) return '—'
  const gb = bytes / (1024 * 1024 * 1024)
  return gb.toFixed(gb >= 10 ? 0 : 1)
}

const isPrepareEvent = (event: PrepareEvent | undefined): event is PrepareEvent =>
  event !== undefined

const resolveAuthExpiry = (authData: AuthEventData) => {
  if (authData.expiresAt) {
    return authData.expiresAt
  }
  if (authData.expiresIn && authData.codeIssuedAt) {
    const issuedAt = new Date(authData.codeIssuedAt).getTime()
    if (!Number.isNaN(issuedAt)) {
      return new Date(issuedAt + authData.expiresIn * 1000).toISOString()
    }
  }
  return undefined
}

const formatPreparePhase = (phase?: PrepareEvent['phase']) => {
  switch (phase) {
    case 'needs_auth':
      return 'Authentication required'
    case 'waiting_for_auth':
      return 'Waiting for authentication'
    case 'authenticated':
      return 'Authenticated'
    case 'downloading':
      return 'Downloading'
    case 'extracting':
      return 'Extracting'
    case 'configured':
      return 'Configured'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
  }
}

const badgeForPhase = (phase?: PrepareEvent['phase']) => {
  if (!phase) return 'badge--muted'
  if (phase === 'error') return 'badge--error'
  if (phase === 'needs_auth' || phase === 'waiting_for_auth') return 'badge--warning'
  if (phase === 'authenticated' || phase === 'downloading' || phase === 'extracting' || phase === 'configured') {
    return 'badge--running'
  }
  return 'badge--muted'
}

export function InstanceOverview() {
  const { id } = useParams()
  const { instance } = useOutletContext<InstanceDetailContext>()
  const [status, setStatus] = useState<InstanceStatus['status']>('unknown')
  const [metrics, setMetrics] = useState<InstanceMetrics | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [prepareState, setPrepareState] = useState<PrepareState>('prepared')
  const [prepareMessage, setPrepareMessage] = useState<string | undefined>(undefined)
  const [prepareErrorCode, setPrepareErrorCode] = useState<string | undefined>(undefined)
  const [prepareJavaIssue, setPrepareJavaIssue] = useState<JavaRequirementIssue | undefined>(undefined)
  const [prepareRun, setPrepareRun] = useState<PrepareRunSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [javaInstall, setJavaInstall] = useState<JavaInstallState | undefined>(undefined)
  const [isPrepareModalOpen, setIsPrepareModalOpen] = useState(false)
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const javaInstallStreamRef = useRef<EventSource | null>(null)
  const prepareEventSourceRef = useRef<EventSource | null>(null)

  const refreshStatus = async () => {
    if (!id) return
    try {
      const statusData = await getInstanceStatus(id)
      setStatus(statusData.status ?? 'unknown')
    } catch (err) {
      console.error('Failed to refresh instance status', err)
    }
  }

  const refreshMetrics = async () => {
    if (!id) return
    try {
      const data = await getInstanceMetrics(id)
      setMetrics(data)
      setMetricsError(null)
      setStatus(data.status ?? 'unknown')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Metrics unavailable'
      setMetricsError(message)
    }
  }

  const updatePrepareState = (
    state: PrepareState,
    message?: string,
    errorCode?: string,
  ) => {
    setPrepareState(state)
    setPrepareMessage(message)
    setPrepareErrorCode(errorCode)
  }

  const triggerPrepare = async (currentInstance: Instance) => {
    if (!id) return
    const prepareOptions: PrepareInstanceOptions = {
      serverType: currentInstance.serverType,
      minecraftVersion: currentInstance.minecraftVersion,
      loader: currentInstance.loader,
    }

    if (currentInstance.serverType === 'hytale') {
      prepareOptions.hytaleInstallMode = currentInstance.hytale?.install?.mode ?? 'downloader'
      prepareOptions.hytaleDownloaderUrl = currentInstance.hytale?.install?.downloaderUrl
      prepareOptions.hytaleImportServerPath = currentInstance.hytale?.install?.importServerPath
      prepareOptions.hytaleImportAssetsPath = currentInstance.hytale?.install?.importAssetsPath
      setIsPrepareModalOpen(true)
    }

    updatePrepareState('preparing')
    setPrepareJavaIssue(undefined)
    const result = await prepareInstance(id, prepareOptions)

    if (result.success) {
      updatePrepareState('prepared', result.message, undefined)
      setPrepareJavaIssue(undefined)
    } else if (result.status === 'needs_java') {
      updatePrepareState(
        'error',
        result.message ?? 'Java runtime required to prepare this instance.',
        undefined,
      )
      setPrepareJavaIssue({
        requirement: result.requirement,
        candidates: result.candidates,
        reasons: result.reasons,
      })
    } else {
      updatePrepareState('error', result.message ?? 'Prepare failed', result.errorCode)
    }

    await refreshStatus()
  }

  const startJavaInstall = async (requirement?: JavaRequirement) => {
    if (!id || !requirement) return
    const major = requirement.major
    if (javaInstallStreamRef.current) {
      javaInstallStreamRef.current.close()
      javaInstallStreamRef.current = null
    }
    setJavaInstall({ status: 'installing', major, progress: 0, message: 'Starting download…' })
    try {
      const result = await installJava(major)
      if (result.status === 'already_installed') {
        setJavaInstall({
          status: 'done',
          major,
          progress: 100,
          message: `Java ${major} is already installed. Retry prepare.`,
        })
        return
      }

      const jobId = result.jobId
      if (!jobId) {
        throw new Error('Java install job not started')
      }

      const source = streamJavaInstall(jobId, (event) => {
        try {
          const data = JSON.parse(event.data) as JavaInstallEvent
          setJavaInstall({
            status: data.phase === 'error' ? 'error' : data.phase === 'done' ? 'done' : 'installing',
            major,
            progress: data.progress,
            message: data.message ?? `Java install ${data.phase}…`,
          })
          if (data.phase === 'done' || data.phase === 'error') {
            source.close()
            javaInstallStreamRef.current = null
          }
        } catch (parseError) {
          console.error('Failed to parse Java install event', parseError)
        }
      })
      javaInstallStreamRef.current = source
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start Java install'
      setJavaInstall({ status: 'error', major, message })
    }
  }

  const activePrepareData = useMemo(() => {
    if (!instance || instance.serverType !== 'hytale') return null
    const events = prepareRun?.events ?? []
    const latestEvent = events[events.length - 1]
    const latestAuthEvent = [...events].reverse().find((event) => {
      const data = event.data as AuthEventData | undefined
      return Boolean(data?.userCode || data?.deviceUrl || data?.authErrorCode)
    })
    const authData = (latestAuthEvent?.data ?? {}) as AuthEventData
    const expiresAt = resolveAuthExpiry(authData)
    const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : null
    const remaining = expiresAtMs && Number.isFinite(expiresAtMs) ? expiresAtMs - now : null
    const expired = remaining !== null ? remaining <= 0 : false
    const expiresLabel =
      remaining === null
        ? null
        : remaining <= 0
          ? 'Code expired'
          : `Code expires in ${Math.floor(remaining / 60_000)}:${Math.floor(
              (remaining % 60_000) / 1000,
            )
              .toString()
              .padStart(2, '0')}`
    const progressEvent = [...events].reverse().find((event) => {
      const data = event.data as { progress?: unknown } | undefined
      return typeof data?.progress === 'number'
    })
    const progress = (progressEvent?.data as { progress?: number } | undefined)?.progress
    const latestErrorEvent = [...events].reverse().find((event) => event.level === 'error')
    const errorData = (latestErrorEvent?.data ?? {}) as PrepareErrorData
    const authErrorCode = authData.authErrorCode
    const authErrorMessage =
      authErrorCode === 'expired_token' || expired
        ? 'Code expired. Generate a new code to continue.'
        : authErrorCode === 'access_denied'
          ? 'User denied authentication. Generate a new code to continue.'
          : authErrorCode === 'slow_down'
            ? 'Authorization pending. Polling slowed down.'
            : authErrorCode === 'authorization_pending'
              ? 'Waiting for authentication confirmation…'
              : undefined
    const showGenerateNewCode = Boolean(
      expired || authErrorCode === 'expired_token' || authErrorCode === 'access_denied',
    )

    return {
      runId: prepareRun?.runId,
      events,
      latestEvent,
      authData,
      expiresLabel,
      expired,
      progress,
      errorData,
      authErrorMessage,
      showGenerateNewCode,
    }
  }, [instance, now, prepareRun])

  useEffect(() => {
    refreshStatus()
    refreshMetrics()
  }, [id])

  useEffect(() => {
    if (!id) return
    if (pollerRef.current) {
      clearInterval(pollerRef.current)
    }

    pollerRef.current = setInterval(() => {
      refreshStatus()
      refreshMetrics()
    }, 4000)

    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current)
        pollerRef.current = null
      }
    }
  }, [id])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!instance || instance.serverType !== 'hytale' || !id) {
      if (prepareEventSourceRef.current) {
        prepareEventSourceRef.current.close()
        prepareEventSourceRef.current = null
      }
      return
    }

    if (prepareEventSourceRef.current) return

    const source = new EventSource(apiUrl(`/api/instances/${id}/prepare/stream`))
    prepareEventSourceRef.current = source

    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as PrepareRunSnapshot
        const events = Array.isArray(payload.events)
          ? payload.events.filter(isPrepareEvent)
          : []
        setPrepareRun({ runId: payload.runId, events })
      } catch (error) {
        console.error('Failed to parse prepare snapshot', error)
      }
    }

    const handleRun = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { runId?: string }
        setPrepareRun({ runId: payload.runId, events: [] })
      } catch (error) {
        console.error('Failed to parse prepare run', error)
      }
    }

    const handlePrepare = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { runId?: string; event?: PrepareEvent }
        if (!payload.event) return
        const prepareEvent = payload.event
        setPrepareRun((prev) => {
          const nextEvents = [...(prev?.events ?? []), prepareEvent]
          const trimmed = nextEvents.length > 200 ? nextEvents.slice(-200) : nextEvents
          return { runId: payload.runId ?? prev?.runId, events: trimmed }
        })
      } catch (error) {
        console.error('Failed to parse prepare event', error)
      }
    }

    source.addEventListener('snapshot', handleSnapshot as EventListener)
    source.addEventListener('run', handleRun as EventListener)
    source.addEventListener('prepare', handlePrepare as EventListener)
    source.onerror = () => {
      source.close()
      prepareEventSourceRef.current = null
    }

    return () => {
      source.close()
      prepareEventSourceRef.current = null
    }
  }, [instance, id])

  useEffect(() => {
    return () => {
      if (javaInstallStreamRef.current) {
        javaInstallStreamRef.current.close()
        javaInstallStreamRef.current = null
      }
      if (prepareEventSourceRef.current) {
        prepareEventSourceRef.current.close()
        prepareEventSourceRef.current = null
      }
    }
  }, [])

  if (!instance) {
    return <div className="alert alert--muted">Instance loading…</div>
  }

  const isRunning = status === 'running' || status === 'starting'
  const cpuValue = isRunning ? metrics?.cpuPercent ?? 0 : null
  const memoryBytes = isRunning ? metrics?.memoryBytes ?? null : null
  const memoryLimitBytes = metrics?.memoryLimitBytes ?? null
  const playersOnline =
    metrics?.onlinePlayers ?? metrics?.playersOnline ?? (isRunning ? null : 0)
  const playersText = playersOnline === null ? '—' : `${playersOnline}`
  const metricsUnavailable = Boolean(metricsError) || metrics?.metricsAvailable === false
  const prepareDisabled = prepareState === 'preparing'
  const hasDownloaderUrlError = prepareErrorCode === 'HYTALE_DOWNLOADER_URL_MISSING'

  return (
    <div className="instance-overview">
      <div className="instance-overview__grid">
        <section className="instance-overview__card">
          <div className="instance-overview__card-header">
            <h2>Status & Ressourcen</h2>
            <span className={`badge badge--${status}`}>{status}</span>
          </div>
          <div className="instance-overview__metrics">
            <div className="instance-overview__metric">
              <span>CPU</span>
              <strong>{cpuValue === null ? '—' : `${cpuValue.toFixed(1)}%`}</strong>
            </div>
            <div className="instance-overview__metric">
              <span>RAM</span>
              <strong>
                {memoryBytes === null
                  ? '—'
                  : `${formatGigabytes(memoryBytes)}${
                      memoryLimitBytes ? ` / ${formatGigabytes(memoryLimitBytes)}` : ''
                    } GB`}
              </strong>
            </div>
            <div className="instance-overview__metric">
              <span>Spieler</span>
              <strong>{playersText}</strong>
            </div>
          </div>
          {metricsUnavailable ? (
            <div className="instance-overview__hint">Metrics unavailable.</div>
          ) : null}
        </section>

        <section className="instance-overview__card">
          <div className="instance-overview__card-header">
            <h2>Vorbereitung</h2>
            <span className={`badge badge--${prepareState === 'prepared' ? 'running' : 'warning'}`}>
              {prepareState === 'prepared'
                ? 'Prepared'
                : prepareState === 'preparing'
                  ? 'Preparing…'
                  : prepareState === 'error'
                    ? 'Error'
                    : 'Not prepared'}
            </span>
          </div>
          <p className="page__hint">
            Vorbereitung stellt sicher, dass alle Server-Dateien vorhanden sind.
          </p>
          <div className="actions actions--inline">
            <button
              className="btn"
              disabled={prepareDisabled}
              onClick={() => triggerPrepare(instance)}
            >
              {prepareState === 'preparing' ? 'Preparing…' : 'Prepare'}
            </button>
            {instance.serverType === 'hytale' ? (
              <button
                className="btn btn--ghost"
                onClick={() => setIsPrepareModalOpen(true)}
              >
                Details
              </button>
            ) : null}
          </div>

          {prepareState === 'preparing' ? (
            <div className="alert alert--muted" style={{ marginTop: 12 }}>
              Preparing server files…
            </div>
          ) : null}

          {prepareState === 'error' || prepareState === 'not_prepared' ? (
            <div className="alert alert--error" style={{ marginTop: 12 }}>
              {prepareMessage ?? 'Server files are not prepared.'}
              {hasDownloaderUrlError ? (
                <div className="page__hint" style={{ marginTop: 8 }}>
                  Set the Hytale Downloader URL in{' '}
                  <Link to={`/instances/${instance.id}/settings`}>Settings</Link> and retry prepare.
                </div>
              ) : null}
              {prepareJavaIssue ? (
                <div style={{ marginTop: 8 }}>
                  <div>
                    {formatJavaRequirement(prepareJavaIssue?.requirement)} is required for this instance.
                  </div>
                  <ul>
                    {formatJavaCandidateList(prepareJavaIssue?.candidates).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <div className="page__hint">
                    Install the required Java version or set a Java Path in{' '}
                    <Link to={`/instances/${instance.id}/settings`}>Settings</Link>. After installation, retry
                    prepare. Manual downloads are available at{' '}
                    <a
                      href={`https://adoptium.net/temurin/releases/?version=${prepareJavaIssue?.requirement?.major}`}
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
                      onClick={() => startJavaInstall(prepareJavaIssue?.requirement)}
                      disabled={javaInstall?.status === 'installing'}
                    >
                      {javaInstall?.status === 'installing'
                        ? 'Installing…'
                        : `Install ${formatJavaRequirement(prepareJavaIssue?.requirement)}`}
                    </button>
                    {javaInstall?.message ? (
                      <span className="page__hint">{javaInstall?.message}</span>
                    ) : null}
                  </div>
                  {javaInstall?.status === 'error' ? (
                    <div className="page__hint" style={{ marginTop: 6 }}>
                      If the download keeps failing, set the Java Path in{' '}
                      <Link to={`/instances/${instance.id}/settings`}>Settings</Link> or install Java{' '}
                      {prepareJavaIssue?.requirement?.major} manually from the Adoptium site.
                    </div>
                  ) : null}
                  {javaInstall?.status === 'installing' ? (
                    <div className="page__hint">
                      Progress: {javaInstall?.progress ?? 0}%
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="actions actions--inline" style={{ marginTop: 12 }}>
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

          {instance.serverType === 'hytale' && prepareRun ? (
            <div className="prepare-panel" style={{ marginTop: 16 }}>
              <div className="prepare-panel__header">
                <div>
                  <strong>Hytale Prepare</strong>
                  <div className="page__hint">
                    {prepareRun.runId ? `Run ID: ${prepareRun.runId}` : 'No prepare run yet.'}
                  </div>
                </div>
                <span className={`badge ${badgeForPhase(activePrepareData?.latestEvent?.phase)}`}>
                  {formatPreparePhase(activePrepareData?.latestEvent?.phase)}
                </span>
              </div>

              {activePrepareData?.authData.deviceUrl || activePrepareData?.authData.userCode ? (
                <div className="prepare-panel__auth">
                  <div>
                    <div className="prepare-panel__label">Verification URL</div>
                    {activePrepareData?.authData.deviceUrl ? (
                      <a href={activePrepareData?.authData.deviceUrl} target="_blank" rel="noreferrer">
                        {activePrepareData?.authData.deviceUrl}
                      </a>
                    ) : (
                      <span className="page__hint">Waiting for URL…</span>
                    )}
                  </div>
                  <div>
                    <div className="prepare-panel__label">User Code</div>
                    <div className="prepare-panel__code">{activePrepareData?.authData.userCode ?? '—'}</div>
                    {activePrepareData?.expiresLabel ? (
                      <div className="page__hint">{activePrepareData?.expiresLabel}</div>
                    ) : null}
                    {activePrepareData?.authData.previousUserCode ? (
                      <div className="page__hint">
                        New code generated. Previous code {activePrepareData?.authData.previousUserCode} is no longer valid.
                      </div>
                    ) : null}
                  </div>
                  <div className="actions actions--inline">
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => {
                        if (activePrepareData?.authData.userCode) {
                          void navigator.clipboard?.writeText(activePrepareData?.authData.userCode)
                        }
                      }}
                      disabled={!activePrepareData?.authData.userCode}
                    >
                      Copy code
                    </button>
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => {
                        if (activePrepareData?.authData.deviceUrl) {
                          window.open(activePrepareData?.authData.deviceUrl, '_blank', 'noreferrer')
                        }
                      }}
                      disabled={!activePrepareData?.authData.deviceUrl}
                    >
                      Open verification URL
                    </button>
                  </div>
                </div>
              ) : (
                <div className="page__hint">
                  Click Prepare to generate a device code. Confirm it immediately to avoid expiration.
                </div>
              )}

              {typeof activePrepareData?.progress === 'number' ? (
                <div className="page__hint">Download progress: {activePrepareData?.progress}%</div>
              ) : null}

              <div className="prepare-panel__events">
                {activePrepareData?.events.length ? (
                  activePrepareData.events.slice(-6).map((event, index) => (
                    <div key={`${event.ts}-${index}`} className="prepare-panel__event">
                      <span className="prepare-panel__time">
                        {new Date(event.ts).toLocaleTimeString()}
                      </span>
                      <span className={`badge ${badgeForPhase(event.phase)}`}>{event.phase}</span>
                      <span>{event.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="page__hint">No prepare events yet.</div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {instance.serverType === 'hytale' && isPrepareModalOpen && activePrepareData ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsPrepareModalOpen(false)}>
          <div
            className="modal modal--wide prepare-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal__header">
              <div>
                <h2>Hytale Prepare</h2>
                <p className="page__hint">
                  {activePrepareData.runId
                    ? `Run ID: ${activePrepareData.runId}`
                    : 'Prepare run will appear once started.'}
                </p>
              </div>
              <button
                className="btn btn--ghost"
                onClick={() => setIsPrepareModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="prepare-modal__status">
              <div>
                <div className="prepare-modal__label">Current phase</div>
                <div className="prepare-modal__phase">
                  <span className={`badge ${badgeForPhase(activePrepareData.latestEvent?.phase)}`}>
                    {formatPreparePhase(activePrepareData.latestEvent?.phase)}
                  </span>
                </div>
              </div>
              <div>
                <div className="prepare-modal__label">Latest update</div>
                <div className="prepare-modal__message">
                  {activePrepareData.latestEvent?.message ?? 'Waiting for prepare to start.'}
                </div>
                {activePrepareData.latestEvent?.phase === 'configured' ? (
                  <div className="alert alert--success" style={{ marginTop: 8 }}>
                    Configured – ready to start.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="prepare-modal__grid">
              <div className="prepare-panel">
                <div className="prepare-panel__header">
                  <strong>Device authentication</strong>
                  <span className={`badge ${badgeForPhase(activePrepareData.latestEvent?.phase)}`}>
                    {formatPreparePhase(activePrepareData.latestEvent?.phase)}
                  </span>
                </div>

                {activePrepareData.authData.deviceUrl || activePrepareData.authData.userCode ? (
                  <div className="prepare-panel__auth">
                    <div>
                      <div className="prepare-panel__label">Verification URL</div>
                      {activePrepareData.authData.deviceUrl ? (
                        <a
                          href={activePrepareData.authData.deviceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {activePrepareData.authData.deviceUrl}
                        </a>
                      ) : (
                        <span className="page__hint">Waiting for URL…</span>
                      )}
                    </div>
                    <div>
                      <div className="prepare-panel__label">User Code</div>
                      <div className="prepare-panel__code">
                        {activePrepareData.authData.userCode ?? '—'}
                      </div>
                      {activePrepareData.expiresLabel ? (
                        <div className="page__hint">{activePrepareData.expiresLabel}</div>
                      ) : null}
                      {activePrepareData.authData.interval ? (
                        <div className="page__hint">
                          Polling interval: {activePrepareData.authData.interval}s
                        </div>
                      ) : null}
                      {activePrepareData.authData.previousUserCode ? (
                        <div className="page__hint">
                          New code generated. Previous code {activePrepareData.authData.previousUserCode} is no longer valid.
                        </div>
                      ) : null}
                      {activePrepareData.authErrorMessage ? (
                        <div className="alert alert--warning" style={{ marginTop: 8 }}>
                          {activePrepareData.authErrorMessage}
                        </div>
                      ) : null}
                    </div>
                    <div className="actions actions--inline">
                      <button
                        className="btn btn--secondary"
                        type="button"
                        onClick={() => {
                          if (activePrepareData.authData.userCode) {
                            void navigator.clipboard?.writeText(activePrepareData.authData.userCode)
                          }
                        }}
                        disabled={!activePrepareData.authData.userCode}
                      >
                        Copy code
                      </button>
                      <button
                        className="btn btn--secondary"
                        type="button"
                        onClick={() => {
                          if (activePrepareData.authData.deviceUrl) {
                            window.open(activePrepareData.authData.deviceUrl, '_blank', 'noreferrer')
                          }
                        }}
                        disabled={!activePrepareData.authData.deviceUrl}
                      >
                        Open verification URL
                      </button>
                      {activePrepareData.showGenerateNewCode ? (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => triggerPrepare(instance)}
                        >
                          Generate new code
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="page__hint">
                    Click Prepare to generate a device code. Confirm it immediately to avoid expiration.
                  </div>
                )}

                {typeof activePrepareData.progress === 'number' ? (
                  <div className="page__hint">
                    Download progress: {activePrepareData.progress}%
                  </div>
                ) : null}
              </div>

              <div className="prepare-modal__logs">
                <div className="prepare-modal__label">Prepare logs</div>
                {activePrepareData.events.length === 0 ? (
                  <div className="page__hint">No prepare events yet.</div>
                ) : (
                  <div className="prepare-modal__log-list">
                    {activePrepareData.events.slice(-12).map((event, index) => (
                      <div key={`${event.ts}-${index}`} className="prepare-modal__log">
                        <span className="prepare-panel__time">
                          {new Date(event.ts).toLocaleTimeString()}
                        </span>
                        <span className={`badge ${badgeForPhase(event.phase)}`}>{event.phase}</span>
                        <span>{event.message}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activePrepareData.errorData.extractPath ? (
                  <div className="alert alert--error" style={{ marginTop: 12 }}>
                    <strong>Extraction details</strong>
                    <div className="page__hint">
                      Path: {activePrepareData.errorData.extractPath}
                    </div>
                    {activePrepareData.errorData.jarCandidates?.length ? (
                      <div className="page__hint">
                        Jar candidates: {activePrepareData.errorData.jarCandidates.join(', ')}
                      </div>
                    ) : null}
                    {activePrepareData.errorData.topLevelFiles?.length ? (
                      <div className="page__hint">
                        Top-level files: {activePrepareData.errorData.topLevelFiles.join(', ')}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default InstanceOverview
