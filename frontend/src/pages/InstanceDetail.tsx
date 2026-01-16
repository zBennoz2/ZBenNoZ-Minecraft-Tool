import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import BackButton from '../components/BackButton'
import {
  Instance,
  InstanceStatus,
  getInstance,
  getInstanceStatus,
  restartInstance,
  startInstance,
  stopInstance,
} from '../api'

export type InstanceDetailContext = {
  instance: Instance | null
  status: InstanceStatus['status']
}

type ActionType = 'start' | 'stop' | 'restart'

interface ActionState {
  id: string
  type: ActionType
}

const tabs = [
  { label: 'Übersicht', to: '' },
  { label: 'Einstellungen', to: 'settings' },
  { label: 'Konsole', to: 'console' },
  { label: 'Dateien', to: 'files' },
  { label: 'Properties', to: 'properties' },
  { label: 'Whitelist', to: 'whitelist' },
  { label: 'Tasks', to: 'tasks' },
]

export function InstanceDetail() {
  const { id } = useParams()
  const [instance, setInstance] = useState<Instance | null>(null)
  const [status, setStatus] = useState<InstanceStatus['status']>('unknown')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<ActionState | null>(null)
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isBusy = Boolean(activeAction)

  const fetchInstance = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [instanceData, statusData] = await Promise.all([
        getInstance(id),
        getInstanceStatus(id),
      ])
      setInstance(instanceData)
      setStatus(statusData.status ?? 'unknown')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load instance'
      setError(message)
      setInstance(null)
      setStatus('unknown')
    } finally {
      setLoading(false)
    }
  }

  const refreshStatus = async () => {
    if (!id) return
    try {
      const statusData = await getInstanceStatus(id)
      setStatus(statusData.status ?? 'unknown')
    } catch (err) {
      console.error('Failed to refresh instance status', err)
    }
  }

  const handleAction = async (type: ActionType) => {
    if (!id || isBusy) return
    setActiveAction({ id, type })
    try {
      if (type === 'start') {
        await startInstance(id)
      } else if (type === 'stop') {
        await stopInstance(id)
      } else {
        await restartInstance(id)
      }
      await refreshStatus()
    } catch (err) {
      console.error('Failed to run instance action', err)
    } finally {
      setActiveAction(null)
    }
  }

  useEffect(() => {
    fetchInstance()
  }, [id])

  useEffect(() => {
    if (!id) return
    if (pollerRef.current) {
      clearInterval(pollerRef.current)
    }

    pollerRef.current = setInterval(refreshStatus, 4000)

    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current)
        pollerRef.current = null
      }
    }
  }, [id])

  const statusBadge = useMemo(() => status ?? 'unknown', [status])
  const isRunning = status === 'running'
  const isStarting = status === 'starting'

  return (
    <section className="page">
      <div className="page__toolbar">
        <BackButton />
      </div>
      <div className="page__header instance-detail__header">
        <div>
          <h1>{instance?.name ?? 'Instance'}</h1>
          <p className="page__hint">
            {instance?.id ? `Instance: ${instance.id}` : 'Instance details'}
          </p>
        </div>
        <div className="instance-detail__actions">
          <span className={`badge badge--${statusBadge}`}>{statusBadge}</span>
          {isRunning ? (
            <>
              <button
                className="btn btn--secondary"
                disabled={isBusy}
                onClick={() => handleAction('stop')}
              >
                {activeAction?.type === 'stop' ? 'Stopping…' : 'Stop'}
              </button>
              <button
                className="btn"
                disabled={isBusy}
                onClick={() => handleAction('restart')}
              >
                {activeAction?.type === 'restart' ? 'Restarting…' : 'Neustart'}
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={isBusy || isStarting}
              onClick={() => handleAction('start')}
            >
              {activeAction?.type === 'start' ? 'Starting…' : 'Start'}
            </button>
          )}
        </div>
      </div>

      {loading ? <div className="alert alert--muted">Loading instance…</div> : null}
      {error ? <div className="alert alert--error">{error}</div> : null}

      <nav className="instance-detail__tabs" aria-label="Instanz Bereiche">
        {tabs.map((tab) => (
          <NavLink
            key={tab.label}
            end={tab.to === ''}
            to={tab.to}
            className={({ isActive }) =>
              `instance-detail__tab${isActive ? ' instance-detail__tab--active' : ''}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="instance-detail__content">
        <Outlet context={{ instance, status }} />
      </div>
    </section>
  )
}

export default InstanceDetail
