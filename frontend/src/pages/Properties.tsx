import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getInstance, getInstanceStatus, restartInstance } from '../api'
import { readServerProperties, writeServerProperties, ServerPropertiesResponse } from '../api/properties'
import { PropertyLine, applyProperties, parseProperties } from '../utils/properties'
import { FormRow, FormSection, FormToggle } from '../components/FormLayout'
import BackButton from '../components/BackButton'

type Mode = 'basic' | 'advanced'
type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard'
type Gamemode = 'survival' | 'creative' | 'adventure' | 'spectator'
type InstanceStatus = 'running' | 'stopped' | 'unknown' | 'starting' | 'error'
type ApiError = Error & { status?: number }

type BasicFormState = {
  motd: string
  maxPlayers: string
  serverPort: string
  levelName: string
  levelSeed: string
  gamemode: Gamemode
  difficulty: Difficulty
  hardcore: boolean
  pvp: boolean
  forceGamemode: boolean
  spawnProtection: string
  allowNether: boolean
  allowEnd: boolean
  generateStructures: boolean
  allowFlight: boolean
  enableCommandBlock: boolean
  onlineMode: boolean
  whiteList: boolean
  enforceWhitelist: boolean
  enableRcon: boolean
  rconPort: string
  rconPassword: string
  viewDistance: string
  simulationDistance: string
  maxWorldSize: string
  playerIdleTimeout: string
}

type ValidationState = Partial<Record<keyof BasicFormState, string>>

const propertyKeyMap: Record<keyof BasicFormState, string> = {
  motd: 'motd',
  maxPlayers: 'max-players',
  serverPort: 'server-port',
  levelName: 'level-name',
  levelSeed: 'level-seed',
  gamemode: 'gamemode',
  difficulty: 'difficulty',
  hardcore: 'hardcore',
  pvp: 'pvp',
  forceGamemode: 'force-gamemode',
  spawnProtection: 'spawn-protection',
  allowNether: 'allow-nether',
  allowEnd: 'allow-end',
  generateStructures: 'generate-structures',
  allowFlight: 'allow-flight',
  enableCommandBlock: 'enable-command-block',
  onlineMode: 'online-mode',
  whiteList: 'white-list',
  enforceWhitelist: 'enforce-whitelist',
  enableRcon: 'enable-rcon',
  rconPort: 'rcon.port',
  rconPassword: 'rcon.password',
  viewDistance: 'view-distance',
  simulationDistance: 'simulation-distance',
  maxWorldSize: 'max-world-size',
  playerIdleTimeout: 'player-idle-timeout',
}

const knownKeys = new Set(Object.values(propertyKeyMap))

const toBoolean = (value: string | undefined, defaultValue = false) => {
  if (typeof value !== 'string') return defaultValue
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return defaultValue
}

const buildBasicForm = (props: Record<string, string>): BasicFormState => ({
  motd: props['motd'] ?? '',
  maxPlayers: props['max-players'] ?? '20',
  serverPort: props['server-port'] ?? '25565',
  levelName: props['level-name'] ?? 'world',
  levelSeed: props['level-seed'] ?? '',
  gamemode: (props['gamemode'] as Gamemode) ?? 'survival',
  difficulty: (props['difficulty'] as Difficulty) ?? 'easy',
  hardcore: toBoolean(props['hardcore'], false),
  pvp: toBoolean(props['pvp'], true),
  forceGamemode: toBoolean(props['force-gamemode'], false),
  spawnProtection: props['spawn-protection'] ?? '16',
  allowNether: toBoolean(props['allow-nether'], true),
  allowEnd: toBoolean(props['allow-end'], true),
  generateStructures: toBoolean(props['generate-structures'], true),
  allowFlight: toBoolean(props['allow-flight'], false),
  enableCommandBlock: toBoolean(props['enable-command-block'], false),
  onlineMode: toBoolean(props['online-mode'], true),
  whiteList: toBoolean(props['white-list'], false),
  enforceWhitelist: toBoolean(props['enforce-whitelist'], false),
  enableRcon: toBoolean(props['enable-rcon'], false),
  rconPort: props['rcon.port'] ?? '25575',
  rconPassword: props['rcon.password'] ?? '',
  viewDistance: props['view-distance'] ?? '10',
  simulationDistance: props['simulation-distance'] ?? '10',
  maxWorldSize: props['max-world-size'] ?? '29999984',
  playerIdleTimeout: props['player-idle-timeout'] ?? '0',
})

const defaultForm = buildBasicForm({})

const validatePort = (value: string, label: string) => {
  if (!value.trim()) return `${label} darf nicht leer sein`
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return `${label} muss zwischen 1 und 65535 liegen`
  }
  return undefined
}

const validatePositive = (value: string, label: string, min = 1) => {
  if (!value.trim()) return `${label} darf nicht leer sein`
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < min) {
    return `${label} muss mindestens ${min} sein`
  }
  return undefined
}

const validateNonNegative = (value: string, label: string) => {
  if (!value.trim()) return `${label} darf nicht leer sein`
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return `${label} darf nicht negativ sein`
  }
  return undefined
}

const validateBasicForm = (form: BasicFormState): ValidationState => {
  const errors: ValidationState = {}
  errors.maxPlayers = validatePositive(form.maxPlayers, 'Max Players', 1)
  errors.serverPort = validatePort(form.serverPort, 'Server Port')
  errors.spawnProtection = validatePositive(form.spawnProtection, 'Spawn Protection', 0)
  errors.viewDistance = validatePositive(form.viewDistance, 'View Distance', 2)
  errors.simulationDistance = validatePositive(form.simulationDistance, 'Simulation Distance', 2)
  errors.maxWorldSize = validatePositive(form.maxWorldSize, 'Max World Size', 1)
  errors.playerIdleTimeout = validateNonNegative(form.playerIdleTimeout, 'Idle Timeout')

  if (form.enableRcon || form.rconPort.trim()) {
    errors.rconPort = validatePort(form.rconPort, 'RCON Port')
  }
  if (form.enableRcon && !form.rconPassword.trim()) {
    errors.rconPassword = 'RCON Password darf nicht leer sein'
  }

  return errors
}

const sections: {
  title: string
  description?: string
  fields: (
    | { id: keyof BasicFormState; label: string; type: 'text' | 'number' | 'password'; help: string; options?: never }
    | {
        id: keyof BasicFormState
        label: string
        type: 'select'
        help: string
        options: { value: string; label: string }[]
      }
    | { id: keyof BasicFormState; label: string; type: 'toggle'; help: string; options?: never }
  )[]
}[] = [
  {
    title: 'Server & Spieler',
    description: 'Basisdaten, Ports und Zugangsregeln für deinen Server.',
    fields: [
      { id: 'motd', label: 'MOTD', type: 'text', help: 'Text im Multiplayer-Browser. Emojis und Farben möglich.' },
      { id: 'maxPlayers', label: 'Max Players', type: 'number', help: 'Begrenzt gleichzeitige Spieler. Höhere Werte brauchen mehr RAM.' },
      { id: 'serverPort', label: 'Server Port', type: 'number', help: 'Standard: 25565. Stelle sicher, dass der Port freigegeben ist.' },
      { id: 'playerIdleTimeout', label: 'Idle Timeout (min)', type: 'number', help: '0 = kein Autokick. Kickt AFK-Spieler nach Minuten.' },
      { id: 'whiteList', label: 'Whitelist', type: 'toggle', help: 'Nur gelistete Spieler dürfen joinen.' },
      { id: 'enforceWhitelist', label: 'Enforce Whitelist', type: 'toggle', help: 'Kick Spieler sofort, wenn sie nicht gelistet sind.' },
      { id: 'onlineMode', label: 'Online Mode', type: 'toggle', help: 'Spieler-Authentifizierung über Mojang. Deaktivieren nur im LAN/offline.' },
    ],
  },
  {
    title: 'Welt & Dimensionen',
    description: 'Weltordner, Seeds und welche Dimensionen erzeugt werden dürfen.',
    fields: [
      { id: 'levelName', label: 'Level Name', type: 'text', help: 'Ordnername der Welt.' },
      { id: 'levelSeed', label: 'Level Seed', type: 'text', help: 'Optionaler Seed. Leer lassen für Zufallswelt.' },
      { id: 'allowNether', label: 'Allow Nether', type: 'toggle', help: 'Aktiviere Reisen ins Nether.' },
      { id: 'allowEnd', label: 'Allow End', type: 'toggle', help: 'Aktiviert die End-Dimension analog zum Nether-Schalter.' },
      { id: 'generateStructures', label: 'Generate Structures', type: 'toggle', help: 'Dörfer, Festungen & Co. erzeugen.' },
    ],
  },
  {
    title: 'Gameplay & Regeln',
    description: 'Spielmodus, Schwierigkeit und Sicherheitsradien.',
    fields: [
      {
        id: 'gamemode',
        label: 'Gamemode',
        type: 'select',
        help: 'Standard-Spielmodus für neue Spieler.',
        options: [
          { value: 'survival', label: 'Survival' },
          { value: 'creative', label: 'Creative' },
          { value: 'adventure', label: 'Adventure' },
          { value: 'spectator', label: 'Spectator' },
        ],
      },
      {
        id: 'difficulty',
        label: 'Difficulty',
        type: 'select',
        help: 'Überlebens-Schwierigkeitsgrad.',
        options: [
          { value: 'peaceful', label: 'Peaceful' },
          { value: 'easy', label: 'Easy' },
          { value: 'normal', label: 'Normal' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      { id: 'forceGamemode', label: 'Force Gamemode', type: 'toggle', help: 'Setzt den Standard-Gamemode bei jedem Login.' },
      { id: 'hardcore', label: 'Hardcore Mode', type: 'toggle', help: 'Ein Leben, Welt wird nach Tod gesperrt.' },
      { id: 'pvp', label: 'PvP', type: 'toggle', help: 'Erlaubt Schaden zwischen Spielern.' },
      { id: 'allowFlight', label: 'Allow Flight', type: 'toggle', help: 'Erlaubt Fliegen (z. B. mit Mods) ohne Kick.' },
      { id: 'spawnProtection', label: 'Spawn Protection', type: 'number', help: 'Sicherheitsradius um den Spawn in Blöcken.' },
    ],
  },
  {
    title: 'Befehle & Remote',
    description: 'Command Blocks und Remote-Konsole absichern.',
    fields: [
      { id: 'enableCommandBlock', label: 'Command Blocks', type: 'toggle', help: 'Erlaubt Command Blocks.' },
      { id: 'enableRcon', label: 'Enable RCON', type: 'toggle', help: 'Remote-Konsole aktivieren.' },
      { id: 'rconPort', label: 'RCON Port', type: 'number', help: 'Port für RCON-Verbindungen.' },
      { id: 'rconPassword', label: 'RCON Password', type: 'password', help: 'RCON Passwort (geheim halten).' },
    ],
  },
  {
    title: 'Performance',
    description: 'Chunk-Entfernungen und Weltgrenzen feinjustieren.',
    fields: [
      { id: 'viewDistance', label: 'View Distance', type: 'number', help: 'Chunks, die Clients sehen. Niedriger = weniger Last.' },
      { id: 'simulationDistance', label: 'Simulation Distance', type: 'number', help: 'Chunks, die getickt werden. Niedriger = weniger CPU.' },
      { id: 'maxWorldSize', label: 'Max World Size', type: 'number', help: 'Maximaler Weltradius (Block). 29999984 ist Vanilla-Default.' },
    ],
  },
]

export function PropertiesPage() {
  const { id } = useParams()

  const [mode, setMode] = useState<Mode>('basic')
  const [exists, setExists] = useState(true)

  const [originalRaw, setOriginalRaw] = useState('')
  const [currentRaw, setCurrentRaw] = useState('')

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restartLoading, setRestartLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [basicForm, setBasicForm] = useState<BasicFormState>(defaultForm)

  const [status, setStatus] = useState<InstanceStatus>('unknown')
  const [statusError, setStatusError] = useState<string | null>(null)
  const [serverType, setServerType] = useState<string | null>(null)

  const parsed = useMemo(() => parseProperties(currentRaw), [currentRaw])

  const validation = useMemo(() => validateBasicForm(basicForm), [basicForm])
  const hasValidationError = useMemo(
    () => Object.values(validation).some((value) => Boolean(value)),
    [validation],
  )

  const isDirty = currentRaw !== originalRaw

  const otherProperties = useMemo(
    () =>
      parsed.lines.reduce<Extract<PropertyLine, { type: 'kv' }>[]>(
        (acc, line) => {
          if (line.type === 'kv' && !knownKeys.has(line.key)) acc.push(line)
          return acc
        },
        [],
      ),
    [parsed],
  )

  const resolveError = (err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback
    const statusCode = (err as ApiError | undefined)?.status

    if (statusCode === 404) {
      if (/Instance not found/i.test(message)) {
        return 'Instance nicht gefunden. Bitte erst anlegen/vorbereiten.'
      }
      return 'server.properties editing not implemented in backend (404)'
    }

    return statusCode ? `[${statusCode}] ${message}` : message
  }

  const syncFormWithRaw = (raw: string) => {
    const mapped = buildBasicForm(parseProperties(raw).props)
    setBasicForm(mapped)
  }

  const applyResponse = (response: ServerPropertiesResponse) => {
    setExists(response.exists)
    const raw = response.raw ?? ''
    setOriginalRaw(raw)
    setCurrentRaw(raw)
    if (mode === 'basic') syncFormWithRaw(raw)
  }

  const refreshStatus = async () => {
    if (!id) return
    try {
      const nextStatus = await getInstanceStatus(id)
      setStatus(nextStatus.status ?? 'unknown')
      setStatusError(null)
    } catch (err) {
      setStatus('unknown')
      setStatusError(resolveError(err, 'Status konnte nicht geladen werden'))
    }
  }

  const fetchProperties = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await readServerProperties(id)
      applyResponse(response)
    } catch (err) {
      setError(resolveError(err, 'Failed to load server.properties'))
    } finally {
      setLoading(false)
    }
  }

  const fetchInstanceType = async () => {
    if (!id) return
    try {
      const instance = await getInstance(id)
      setServerType(instance.serverType)
    } catch {
      setServerType(null)
    }
  }

  useEffect(() => {
    fetchProperties()
    refreshStatus()
    fetchInstanceType()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (mode === 'basic') syncFormWithRaw(currentRaw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const updateRawFromForm = (field: keyof BasicFormState, value: string | boolean) => {
    const propertyKey = propertyKeyMap[field]
    if (!propertyKey) return
    const normalizedValue = typeof value === 'boolean' ? (value ? 'true' : 'false') : value
    setCurrentRaw((prev) => applyProperties(prev, { [propertyKey]: normalizedValue }, []))
  }

  const handleInputChange = (field: keyof BasicFormState, value: string) => {
    setBasicForm((prev) => ({ ...prev, [field]: value }))
    updateRawFromForm(field, value)
    setSuccess(null)
  }

  const handleToggle = (field: keyof BasicFormState) => {
    setBasicForm((prev) => {
      const nextValue = !(prev[field] as boolean)
      const next = { ...prev, [field]: nextValue }
      updateRawFromForm(field, nextValue)
      return next
    })
    setSuccess(null)
  }

  const handleRawChange = (raw: string) => {
    setCurrentRaw(raw)
    setSuccess(null)
  }

  const handleReset = () => {
    setCurrentRaw(originalRaw)
    if (mode === 'basic') syncFormWithRaw(originalRaw)
    setSuccess(null)
  }

  const handleSave = async () => {
    if (!id || hasValidationError) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await writeServerProperties(id, currentRaw)
      setExists(response.exists)
      const savedRaw = response.raw ?? currentRaw
      setOriginalRaw(savedRaw)
      setCurrentRaw(savedRaw)
      if (mode === 'basic') syncFormWithRaw(savedRaw)
      setSuccess('server.properties gespeichert. Änderungen werden erst nach Restart wirksam.')
    } catch (err) {
      setError(resolveError(err, 'Failed to save server.properties'))
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    if (!id) return
    setRestartLoading(true)
    setError(null)
    try {
      await restartInstance(id)
      setSuccess('Restart gestartet.')
      await refreshStatus()
    } catch (err) {
      setError(resolveError(err, 'Failed to restart instance'))
    } finally {
      setRestartLoading(false)
    }
  }

  const statusHint = statusError
    ? statusError
    : status === 'running'
      ? 'Instance läuft'
      : status === 'stopped'
        ? 'Instance gestoppt'
        : 'Status unbekannt'

  if (serverType === 'hytale') {
    return (
      <section className="page properties-page">
        <div className="page__toolbar">
          <BackButton fallback={id ? `/instances/${id}/console` : '/'} />
        </div>
        <div className="page__header page__header--spread">
          <div className="page__cluster">
            <h1>Server Settings</h1>
            {id ? <span className="page__id">Instance: {id}</span> : null}
            <p className="page__hint">Hytale nutzt keine server.properties. Bitte verwende den Settings-Tab.</p>
          </div>
        </div>
        <div className="alert alert--muted">{statusHint}</div>
      </section>
    )
  }

  return (
    <section className="page properties-page">
      <div className="page__toolbar">
        <BackButton fallback={id ? `/instances/${id}/console` : '/'} />
      </div>
      <div className="page__header page__header--spread">
        <div className="page__cluster">
          <h1>Server Settings</h1>
          {id ? <span className="page__id">Instance: {id}</span> : null}
          <p className="page__hint">Bearbeite server.properties komfortabel oder im Raw-Editor.</p>
        </div>

        <div className="actions properties__actions">
          <div className="properties__mode">
            <button
              className={`btn btn--ghost ${mode === 'basic' ? 'btn--active' : ''}`}
              onClick={() => setMode('basic')}
            >
              Basic
            </button>
            <button
              className={`btn btn--ghost ${mode === 'advanced' ? 'btn--active' : ''}`}
              onClick={() => setMode('advanced')}
            >
              Advanced
            </button>
          </div>

          <button className="btn btn--ghost" onClick={fetchProperties} disabled={loading || saving}>
            {loading ? 'Reloading…' : 'Reload'}
          </button>

          <button className="btn btn--ghost" onClick={handleReset} disabled={saving || loading || !isDirty}>
            Reset
          </button>

          <button className="btn" onClick={handleSave} disabled={saving || loading || !isDirty || hasValidationError}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="properties-page__content">
        {error ? <div className="alert alert--error">{error}</div> : null}

        {success ? (
          <div className="alert alert--muted">
            {success}
            <div className="actions actions--inline">
              <button className="btn btn--secondary" onClick={fetchProperties} disabled={loading}>
                Reload
              </button>
              {status === 'running' ? (
                <button className="btn" onClick={handleRestart} disabled={restartLoading}>
                  {restartLoading ? 'Restarting…' : 'Restart now'}
                </button>
              ) : (
                <span className="properties__restart-hint">Restart verfügbar, sobald die Instance läuft.</span>
              )}
            </div>
          </div>
        ) : null}

        {loading ? <div className="alert alert--muted">Loading server.properties…</div> : null}

        {!loading && !exists ? (
          <div className="alert alert--muted">
            server.properties existiert noch nicht. Bitte Instance vorbereiten/gestartet haben oder neu speichern.
          </div>
        ) : null}

        <div className="properties__status">{statusHint}</div>

        {mode === 'basic' ? (
          <>
            <div className="properties__grid">
              {sections.map((section) => (
                <FormSection key={section.title} title={section.title} description={section.description}>
                  {section.fields.map((field) => {
                  const fieldValue = basicForm[field.id]
                  const errorText = validation[field.id]
                  const disableInput =
                    (field.id === 'rconPort' || field.id === 'rconPassword') && !basicForm.enableRcon

                    if (field.type === 'toggle') {
                      const boolValue = Boolean(fieldValue)
                      return (
                        <FormRow key={field.id} label={field.label} help={field.help}>
                          <FormToggle
                            label={field.label}
                            description={field.help}
                            checked={boolValue}
                            onChange={() => handleToggle(field.id)}
                            showLabel={false}
                            ariaLabel={field.label}
                          />
                        </FormRow>
                      )
                    }

                  if (field.type === 'select') {
                    return (
                      <FormRow key={field.id} label={field.label} help={field.help}>
                        <select
                          value={String(fieldValue)}
                          onChange={(event) => handleInputChange(field.id, event.target.value)}
                          disabled={disableInput}
                        >
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {errorText ? <span className="form__error">{errorText}</span> : null}
                      </FormRow>
                    )
                  }

                  return (
                    <FormRow key={field.id} label={field.label} help={field.help}>
                      <input
                        type={field.type}
                        value={String(fieldValue)}
                        onChange={(event) => handleInputChange(field.id, event.target.value)}
                        min={field.type === 'number' ? 0 : undefined}
                        disabled={disableInput}
                      />
                      {errorText ? <span className="form__error">{errorText}</span> : null}
                    </FormRow>
                  )
                  })}
                </FormSection>
              ))}

              <FormSection
                title="Other properties"
                description="Alle nicht gemappten Keys bleiben erhalten. Bearbeite sie im Advanced Mode."
              >
                {otherProperties.length === 0 ? (
                  <div className="empty">Keine weiteren properties gefunden.</div>
                ) : (
                  <div className="properties__table">
                    <div className="properties__table-row properties__table-head">
                      <span>Key</span>
                      <span>Value</span>
                    </div>
                    {otherProperties.map((line, index) => (
                      <div key={`${line.key}-${index}`} className="properties__table-row">
                        <span className="properties__mono">{line.key}</span>
                        <span className="properties__mono">{line.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </FormSection>
            </div>

            {hasValidationError ? (
              <div className="alert alert--error">Bitte behebe die Validierungsfehler, bevor du speicherst.</div>
            ) : null}
          </>
        ) : (
          <FormSection title="Advanced / Raw" description="Advanced mode edits the raw file.">
            <textarea
              className="textarea properties__raw"
              spellCheck={false}
              value={currentRaw}
              onChange={(event) => handleRawChange(event.target.value)}
              rows={28}
              disabled={loading}
            />
          </FormSection>
        )}
      </div>
    </section>
  )
}

export default PropertiesPage
