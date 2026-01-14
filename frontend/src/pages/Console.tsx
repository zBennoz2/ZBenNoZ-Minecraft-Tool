import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import BackButton from '../components/BackButton'
import { Instance, InstanceStatus, getHytaleAuthStatus, getInstance, getInstanceStatus, sendCommand } from '../api'
import { apiUrl } from '../config'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
const MAX_LOGS = 2000

type HytaleAuthInfo = {
  authenticated: boolean
  deviceUrl?: string
  userCode?: string
  matchedLine?: string
}

const DEVICE_URL_PATTERN = /(https?:\/\/accounts\.hytale\.com\/device)/i
const DEVICE_CODE_PATTERN = /\b(?:code|device code|user code)\s*[:=]\s*([a-z0-9-]{4,})/i
const AUTH_SUCCESS_PATTERN = /authentication successful/i

const parseLogLine = (data: string): string => {
  try {
    const parsed = JSON.parse(data)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      if ('message' in parsed && typeof parsed.message === 'string') {
        return parsed.message
      }
      if ('log' in parsed && typeof (parsed as { log?: unknown }).log === 'string') {
        return String((parsed as { log?: unknown }).log)
      }
    }
    return JSON.stringify(parsed)
  } catch (error) {
    return data
  }
}

const extractHytaleAuthInfo = (line: string): HytaleAuthInfo | null => {
  if (AUTH_SUCCESS_PATTERN.test(line)) {
    return { authenticated: true, matchedLine: line }
  }

  const urlMatch = line.match(DEVICE_URL_PATTERN)
  const codeMatch = line.match(DEVICE_CODE_PATTERN)
  if (urlMatch || codeMatch) {
    return {
      authenticated: false,
      deviceUrl: urlMatch?.[1],
      userCode: codeMatch?.[1]?.toUpperCase(),
      matchedLine: line,
    }
  }

  return null
}

export function ConsolePage() {
  const { id } = useParams()
  const [logs, setLogs] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [command, setCommand] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [instanceStatus, setInstanceStatus] = useState<InstanceStatus['status']>('unknown')
  const [instanceInfo, setInstanceInfo] = useState<Instance | null>(null)
  const [hytaleAuth, setHytaleAuth] = useState<HytaleAuthInfo | null>(null)
  const [hytaleAuthError, setHytaleAuthError] = useState<string | null>(null)
  const [hytaleAuthLoading, setHytaleAuthLoading] = useState(false)
  const [hytaleCommandSending, setHytaleCommandSending] = useState(false)
  const [commandApiMissing, setCommandApiMissing] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const logContainerRef = useRef<HTMLDivElement | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const draftCommandRef = useRef('')

  const historyStorageKey = useMemo(() => (id ? `commandHistory:${id}` : null), [id])

  useEffect(() => {
    if (!historyStorageKey) return

    try {
      const stored = localStorage.getItem(historyStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
          setHistory(parsed)
        }
      } else {
        setHistory([])
      }
    } catch (error) {
      console.error('Failed to parse command history', error)
      setHistory([])
    }

    setHistoryIndex(-1)
    setCommand('')
    draftCommandRef.current = ''
    setCommandApiMissing(false)
    setCommandError(null)
  }, [historyStorageKey])

  useEffect(() => {
    if (!id) {
      setInstanceInfo(null)
      return
    }

    let cancelled = false
    getInstance(id)
      .then((instance) => {
        if (!cancelled) setInstanceInfo(instance)
      })
      .catch(() => {
        if (!cancelled) setInstanceInfo(null)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!id || instanceInfo?.serverType !== 'hytale') {
      setHytaleAuth(null)
      return
    }

    let cancelled = false
    const fetchAuth = async () => {
      setHytaleAuthLoading(true)
      setHytaleAuthError(null)
      try {
        const status = await getHytaleAuthStatus(id)
        if (!cancelled) {
          setHytaleAuth({
            authenticated: status.authenticated,
            deviceUrl: status.deviceUrl,
            userCode: status.userCode,
            matchedLine: status.matchedLine,
          })
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load auth status'
          setHytaleAuthError(message)
        }
      } finally {
        if (!cancelled) setHytaleAuthLoading(false)
      }
    }

    fetchAuth()
    const interval = setInterval(fetchAuth, 8000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [id, instanceInfo?.serverType])

  const persistHistory = useCallback(
    (entries: string[]) => {
      if (!historyStorageKey) return
      localStorage.setItem(historyStorageKey, JSON.stringify(entries))
    },
    [historyStorageKey],
  )

  const appendLog = useCallback(
    (line: string) => {
      setLogs((prev) => {
        const next = [...prev, line]
        if (next.length > MAX_LOGS) {
          next.splice(0, next.length - MAX_LOGS)
        }
        return next
      })

      if (instanceInfo?.serverType === 'hytale') {
        const info = extractHytaleAuthInfo(line)
        if (info) {
          setHytaleAuth((prev) => ({
            authenticated: info.authenticated || prev?.authenticated || false,
            deviceUrl: info.deviceUrl ?? prev?.deviceUrl,
            userCode: info.userCode ?? prev?.userCode,
            matchedLine: info.matchedLine ?? prev?.matchedLine,
          }))
        }
      }
    },
    [instanceInfo?.serverType],
  )

  useEffect(() => {
    if (!id) {
      setConnectionState('disconnected')
      return undefined
    }

    setLogs([])
    setConnectionState((prev) => (prev === 'reconnecting' ? 'reconnecting' : 'connecting'))
    const url = apiUrl(`/api/instances/${id}/logs/stream`)
    // eslint-disable-next-line no-console
    console.log('[api] Requesting', url)
    const source = new EventSource(url)
    eventSourceRef.current = source

    const handleMessage = (event: MessageEvent) => {
      appendLog(parseLogLine(event.data))
    }

    const handleStatus = (event: MessageEvent) => {
      setInstanceStatus(String(event.data) as InstanceStatus['status'])
    }

    source.onopen = () => setConnectionState('connected')
    source.onmessage = handleMessage
    source.addEventListener('log', handleMessage as EventListener)
    source.addEventListener('status', handleStatus as EventListener)
    source.onerror = () => {
      setConnectionState('disconnected')
      source.close()
      eventSourceRef.current = null
    }

    return () => {
      setConnectionState('disconnected')
      source.close()
      eventSourceRef.current = null
    }
  }, [appendLog, id, connectionAttempt])

  useEffect(() => {
    if (!id) {
      setInstanceStatus('unknown')
      return
    }

    let cancelled = false
    getInstanceStatus(id)
      .then((status) => {
        if (!cancelled) {
          setInstanceStatus(status.status ?? 'unknown')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInstanceStatus('unknown')
        }
      })

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const container = logContainerRef.current
    if (!container) return undefined

    const handleScroll = () => {
      const threshold = 24
      const atBottom =
        container.scrollHeight - container.clientHeight - container.scrollTop < threshold
      setIsAtBottom(atBottom)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!autoScroll || !isAtBottom) return
    const container = logContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [logs, autoScroll, isAtBottom])

  const handleReconnect = () => {
    if (!id) return
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setConnectionState('reconnecting')
    setConnectionAttempt((prev) => prev + 1)
  }

  const canSendCommand = instanceStatus === 'running' && !commandApiMissing

  const handleHistoryNavigation = useCallback(
    (direction: 'up' | 'down') => {
      if (history.length === 0) return

      if (direction === 'up') {
        setHistoryIndex((prev) => {
          const nextIndex = prev <= 0 ? history.length - 1 : prev - 1
          if (prev === -1) {
            draftCommandRef.current = command
          }
          setCommand(history[nextIndex] ?? '')
          return nextIndex
        })
        return
      }

      setHistoryIndex((prev) => {
        if (prev === -1) return prev
        if (prev >= history.length - 1) {
          setCommand(draftCommandRef.current)
          return -1
        }

        const nextIndex = prev + 1
        setCommand(history[nextIndex] ?? '')
        return nextIndex
      })
    },
    [command, history],
  )

  const handleSendCommand = async (commandOverride?: string) => {
    if (!id) return

    const normalized = (commandOverride ?? command).trim()
    if (normalized.length === 0) return

    setCommandError(null)
    setCommandApiMissing(false)
    setIsSending(true)

    try {
      await sendCommand(id, normalized)
      appendLog(`> ${normalized}`)
      setCommand('')
      draftCommandRef.current = ''
      setHistoryIndex(-1)
      setHistory((prev) => {
        const next = [...prev, normalized].slice(-50)
        persistHistory(next)
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send command'
      const missingApi = /404|not found/i.test(message)
      setCommandError(missingApi ? 'Command API not implemented' : message)
      setCommandApiMissing(missingApi)
    } finally {
      setIsSending(false)
    }
  }

  const handleHytaleDeviceAuth = async () => {
    if (!id) return
    setHytaleCommandSending(true)
    setHytaleAuthError(null)
    try {
      await sendCommand(id, '/auth login device')
      appendLog('> /auth login device')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send auth command'
      setHytaleAuthError(message)
    } finally {
      setHytaleCommandSending(false)
    }
  }

  const quickActions = useMemo(
    () => [
      { label: 'stop', command: 'stop' },
      { label: 'save-all', command: 'save-all' },
      { label: 'list', command: 'list' },
      { label: 'say Server is restarting…', command: 'say Server is restarting…' },
    ],
    [],
  )

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendCommand()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      handleHistoryNavigation('up')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      handleHistoryNavigation('down')
    }
  }

  const statusLabel = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return 'Connected'
      case 'reconnecting':
        return 'Reconnecting…'
      case 'disconnected':
        return 'Disconnected'
      default:
        return 'Connecting…'
    }
  }, [connectionState])

  const instanceStatusLabel = useMemo(() => {
    switch (instanceStatus) {
      case 'running':
        return 'Instance running'
      case 'starting':
        return 'Instance starting'
      case 'error':
        return 'Instance error'
      case 'stopped':
        return 'Instance stopped'
      default:
        return 'Instance status unknown'
    }
  }, [instanceStatus])

  const logsHint = useMemo(() => {
    if (connectionState === 'disconnected') {
      return 'Disconnected from log stream. Try reconnecting.'
    }
    if (connectionState === 'reconnecting') {
      return 'Reconnecting to log stream…'
    }
    return 'Waiting for logs…'
  }, [connectionState])

  return (
    <section className="page">
      <div className="page__toolbar">
        <BackButton fallback={id ? `/instances/${id}/console` : '/'} />
      </div>
      <div className="page__header page__header--spread">
        <div>
          <h1>Console</h1>
          {id ? <span className="page__id">Instance: {id}</span> : null}
        </div>
        <div className="console__actions">
          <span className={`badge badge--${connectionState}`}>{statusLabel}</span>
          <span className={`badge badge--${instanceStatus}`}>{instanceStatusLabel}</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
            />
            Auto-scroll
          </label>
          <button className="btn btn--ghost" onClick={handleReconnect} disabled={!id}>
            Reconnect
          </button>
          <button className="btn btn--ghost" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>
      </div>

      {instanceInfo?.serverType === 'hytale' ? (
        <div className="alert alert--muted">
          <div className="page__cluster">
            <strong>Authenticate server</strong>
            <div>
              Status:{' '}
              {hytaleAuth?.authenticated ? (
                <span className="badge badge--running">Authenticated</span>
              ) : (
                <span className="badge badge--warning">Not authenticated</span>
              )}
            </div>
            <p className="page__hint">
              Run <code>/auth login device</code> in the server console, then confirm the code at{' '}
              <a href="https://accounts.hytale.com/device" target="_blank" rel="noreferrer">
                accounts.hytale.com/device
              </a>
              . Limit: 100 servers per license.
            </p>
            {hytaleAuthLoading ? <div className="page__hint">Loading auth status…</div> : null}
            {hytaleAuthError ? <div className="alert alert--error">{hytaleAuthError}</div> : null}
            {hytaleAuth?.userCode || hytaleAuth?.deviceUrl ? (
              <div className="page__hint">
                {hytaleAuth?.deviceUrl ? (
                  <div>
                    URL:{' '}
                    <a href={hytaleAuth.deviceUrl} target="_blank" rel="noreferrer">
                      {hytaleAuth.deviceUrl}
                    </a>
                  </div>
                ) : null}
                {hytaleAuth?.userCode ? <div>Code: {hytaleAuth.userCode}</div> : null}
              </div>
            ) : null}
            <div className="actions actions--inline">
              <button
                className="btn"
                onClick={handleHytaleDeviceAuth}
                disabled={hytaleCommandSending || instanceStatus !== 'running'}
              >
                {hytaleCommandSending ? 'Sending…' : 'Console Quick Command'}
              </button>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => window.open('https://accounts.hytale.com/device', '_blank', 'noreferrer')}
              >
                Open Auth Instructions
              </button>
              <button className="btn btn--secondary" onClick={() => setHytaleAuth(null)}>
                Clear Auth Info
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="console__log" ref={logContainerRef}>
        {logs.length === 0 ? (
          <p className="page__hint">{logsHint}</p>
        ) : (
          logs.map((line, index) => (
            <pre key={`${index}-${line.slice(0, 6)}`} className="console__line">
              {line}
            </pre>
          ))
        )}
      </div>

      <div className="console__panel">
        <div className="console__quick-actions">
          <span className="console__quick-label">Quick actions</span>
          {quickActions.map((action) => (
            <button
              key={action.label}
              className="btn btn--ghost"
              type="button"
              disabled={!canSendCommand || isSending}
              onClick={() => handleSendCommand(action.command)}
            >
              {action.label}
            </button>
          ))}
        </div>

        {commandApiMissing ? (
          <div className="alert alert--error">Command API not implemented</div>
        ) : null}

        {!canSendCommand ? (
          <div className="alert alert--muted">Start the server to send commands.</div>
        ) : null}

        <form
          className="console__form"
          onSubmit={(event) => {
            event.preventDefault()
            handleSendCommand()
          }}
        >
          <input
            type="text"
            className="console__input"
            placeholder="Command…"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={handleCommandKeyDown}
            disabled={!canSendCommand || isSending}
          />
          <button
            className="btn"
            type="submit"
            disabled={!canSendCommand || isSending || command.trim().length === 0}
          >
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </form>

        {commandError ? <div className="alert alert--error">{commandError}</div> : null}
      </div>
    </section>
  )
}

export default ConsolePage
