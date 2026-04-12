import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BackButton from '../components/BackButton'
import ModalPortal from '../components/ModalPortal'
import useWindowContext from '../hooks/useWindowContext'
import {
  CreateTaskPayload,
  ScheduledTask,
  TaskAction,
  TaskEventType,
  TaskSchedule,
  TaskTrigger,
  createInstanceTask,
  deleteTask as apiDeleteTask,
  getInstanceTasks,
  updateTask as apiUpdateTask,
} from '../api'

const lifecycleLabels: Record<'backup' | 'restart' | 'stop' | 'start' | 'sleep', string> = {
  backup: 'Backup',
  restart: 'Restart',
  stop: 'Stop',
  start: 'Start',
  sleep: 'Force Sleep',
}

const eventLabels: Record<TaskEventType, string> = {
  PlayerJoin: 'PlayerJoin',
  PlayerLeave: 'PlayerLeave',
  LastPlayerLeft: 'LastPlayerLeft',
  FirstPlayerJoined: 'FirstPlayerJoined',
  ServerEmpty: 'ServerEmpty',
  ServerStarted: 'ServerStarted',
  ServerStopped: 'ServerStopped',
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  try {
    const date = new Date(value)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  } catch {
    return '—'
  }
}

interface TaskFormState {
  enabled: boolean
  triggerType: 'schedule' | 'event'
  mode: 'interval' | 'daily' | 'weekly' | 'cron'
  intervalValue: number
  intervalUnit: 'minutes' | 'hours'
  timeOfDay: string
  dayOfWeek: string
  cronExpression: string
  eventType: TaskEventType
  eventDelaySeconds: number
  requireOnlinePlayers: 'any' | 'non_empty' | 'empty'
  actionType: TaskAction['type']
  lifecycleOperation: 'backup' | 'restart' | 'stop' | 'start' | 'sleep'
  command: string
  message: string
  messageFormat: 'plain' | 'legacy' | 'json'
  followUpCommand: string
  followUpDelaySeconds: number
}

const defaultFormState: TaskFormState = {
  enabled: true,
  triggerType: 'schedule',
  mode: 'interval',
  intervalValue: 6,
  intervalUnit: 'hours',
  timeOfDay: '04:00',
  dayOfWeek: '0',
  cronExpression: '0 4 * * *',
  eventType: 'PlayerJoin',
  eventDelaySeconds: 0,
  requireOnlinePlayers: 'any',
  actionType: 'lifecycle',
  lifecycleOperation: 'restart',
  command: '',
  message: '',
  messageFormat: 'plain',
  followUpCommand: '',
  followUpDelaySeconds: 180,
}

const buildSchedule = (state: TaskFormState): TaskSchedule | null => {
  switch (state.mode) {
    case 'interval': {
      const minutes = state.intervalValue * (state.intervalUnit === 'hours' ? 60 : 1)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      return { mode: 'interval', intervalMinutes: minutes }
    }
    case 'daily': {
      const [hours, minutes] = state.timeOfDay.split(':').map((part) => Number.parseInt(part, 10))
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
      return { mode: 'cron', expression: `${minutes} ${hours} * * *` }
    }
    case 'weekly': {
      const [hours, minutes] = state.timeOfDay.split(':').map((part) => Number.parseInt(part, 10))
      const day = Number.parseInt(state.dayOfWeek, 10)
      if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(day)) return null
      return { mode: 'cron', expression: `${minutes} ${hours} * * ${day}` }
    }
    case 'cron':
      return state.cronExpression.trim() ? { mode: 'cron', expression: state.cronExpression.trim() } : null
    default:
      return null
  }
}

const buildTrigger = (state: TaskFormState): TaskTrigger | null => {
  if (state.triggerType === 'schedule') {
    const schedule = buildSchedule(state)
    if (!schedule) return null
    return { type: 'schedule', schedule }
  }

  return {
    type: 'event',
    event: state.eventType,
    delaySeconds: Math.max(0, Math.floor(state.eventDelaySeconds)),
    requireOnlinePlayers: state.requireOnlinePlayers,
  }
}

const buildAction = (state: TaskFormState): TaskAction | null => {
  if (state.actionType === 'lifecycle') {
    return { type: 'lifecycle', operation: state.lifecycleOperation }
  }

  if (state.actionType === 'command') {
    const command = state.command.trim()
    if (!command) return null
    return { type: 'command', command }
  }

  if (state.actionType === 'message') {
    const message = state.message.trim()
    if (!message) return null
    return { type: 'message', message, format: state.messageFormat }
  }

  if (state.actionType === 'message_then_command') {
    const message = state.message.trim()
    const command = state.followUpCommand.trim()
    const delaySeconds = Math.max(0, Math.floor(state.followUpDelaySeconds))
    if (!message || !command) return null
    return { type: 'message_then_command', message, command, delaySeconds, format: state.messageFormat }
  }

  return null
}

const scheduleLabel = (trigger: TaskTrigger) => {
  if (trigger.type === 'event') {
    return `${eventLabels[trigger.event]}${trigger.delaySeconds ? ` (+${trigger.delaySeconds}s)` : ''}`
  }

  if (trigger.schedule.mode === 'interval') {
    const hours = trigger.schedule.intervalMinutes / 60
    if (Number.isInteger(hours)) return `Every ${hours}h`
    return `Every ${trigger.schedule.intervalMinutes}m`
  }
  return trigger.schedule.expression
}

const actionLabel = (action: TaskAction) => {
  if (action.type === 'lifecycle') return lifecycleLabels[action.operation]
  if (action.type === 'command') return `Command: ${action.command}`
  if (action.type === 'message') return `Message`
  return `Message + delayed command (${action.delaySeconds}s)`
}

const deriveFormState = (task?: ScheduledTask): TaskFormState => {
  if (!task) return defaultFormState

  const trigger = task.trigger
  const action = task.action
  const state: TaskFormState = {
    ...defaultFormState,
    enabled: task.enabled,
    triggerType: trigger.type,
  }

  if (trigger.type === 'schedule') {
    if (trigger.schedule.mode === 'interval') {
      state.mode = 'interval'
      state.intervalValue =
        trigger.schedule.intervalMinutes % 60 === 0
          ? trigger.schedule.intervalMinutes / 60
          : trigger.schedule.intervalMinutes
      state.intervalUnit = trigger.schedule.intervalMinutes % 60 === 0 ? 'hours' : 'minutes'
    } else {
      state.mode = 'cron'
      state.cronExpression = trigger.schedule.expression
    }
  } else {
    state.eventType = trigger.event
    state.eventDelaySeconds = trigger.delaySeconds ?? 0
    state.requireOnlinePlayers = trigger.requireOnlinePlayers ?? 'any'
  }

  state.actionType = action.type
  if (action.type === 'lifecycle') {
    state.lifecycleOperation = action.operation
  }
  if (action.type === 'command') {
    state.command = action.command
  }
  if (action.type === 'message') {
    state.message = action.message
    state.messageFormat = action.format ?? 'plain'
  }
  if (action.type === 'message_then_command') {
    state.message = action.message
    state.followUpCommand = action.command
    state.followUpDelaySeconds = action.delaySeconds
    state.messageFormat = action.format ?? 'plain'
  }

  return state
}

interface TaskModalProps {
  initial?: ScheduledTask
  onClose: () => void
  onSubmit: (task: CreateTaskPayload, existingId?: string) => Promise<void>
}

function TaskModal({ initial, onClose, onSubmit }: TaskModalProps) {
  const [formState, setFormState] = useState<TaskFormState>(deriveFormState(initial))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFormState(deriveFormState(initial))
  }, [initial])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    const trigger = buildTrigger(formState)
    const action = buildAction(formState)
    if (!trigger) return setError('Please provide a valid trigger')
    if (!action) return setError('Please provide a valid action')

    setSaving(true)
    try {
      await onSubmit({ trigger, action, enabled: formState.enabled }, initial?.id)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal onClose={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2>{initial ? 'Edit Task' : 'Create Task'}</h2>
            <p className="page__hint">Configure trigger + action automation for this instance.</p>
          </div>
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>

        <form className="form modal__form" onSubmit={handleSubmit}>
          <div className="modal__body">
            <label className="form__field">
              <span>Enabled</span>
              <label className="toggle">
                <input type="checkbox" checked={formState.enabled} onChange={(event) => setFormState((p) => ({ ...p, enabled: event.target.checked }))} />
                Toggle
              </label>
            </label>

            <fieldset className="form__fieldset">
              <legend>Trigger</legend>
              <div className="form__inline">
                <label className="form__field">
                  <span>Trigger Type</span>
                  <select value={formState.triggerType} onChange={(event) => setFormState((p) => ({ ...p, triggerType: event.target.value as 'schedule' | 'event' }))}>
                    <option value="schedule">Schedule</option>
                    <option value="event">Event</option>
                  </select>
                </label>

                {formState.triggerType === 'schedule' ? (
                  <>
                    <label className="form__field">
                      <span>Mode</span>
                      <select value={formState.mode} onChange={(event) => setFormState((p) => ({ ...p, mode: event.target.value as TaskFormState['mode'] }))}>
                        <option value="interval">Every X minutes/hours</option>
                        <option value="daily">Daily at</option>
                        <option value="weekly">Weekly</option>
                        <option value="cron">Advanced cron</option>
                      </select>
                    </label>

                    {formState.mode === 'interval' ? (
                      <>
                        <label className="form__field"><span>Every</span><input type="number" min={1} value={formState.intervalValue} onChange={(event) => setFormState((p) => ({ ...p, intervalValue: Number(event.target.value) }))} /></label>
                        <label className="form__field"><span>Unit</span><select value={formState.intervalUnit} onChange={(event) => setFormState((p) => ({ ...p, intervalUnit: event.target.value as 'minutes' | 'hours' }))}><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>
                      </>
                    ) : null}

                    {formState.mode === 'daily' || formState.mode === 'weekly' ? (
                      <label className="form__field"><span>Time</span><input type="time" value={formState.timeOfDay} onChange={(event) => setFormState((p) => ({ ...p, timeOfDay: event.target.value }))} /></label>
                    ) : null}

                    {formState.mode === 'weekly' ? (
                      <label className="form__field"><span>Day of week</span><select value={formState.dayOfWeek} onChange={(event) => setFormState((p) => ({ ...p, dayOfWeek: event.target.value }))}><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></label>
                    ) : null}

                    {formState.mode === 'cron' ? (
                      <label className="form__field"><span>Cron</span><input type="text" value={formState.cronExpression} onChange={(event) => setFormState((p) => ({ ...p, cronExpression: event.target.value }))} /></label>
                    ) : null}
                  </>
                ) : (
                  <>
                    <label className="form__field"><span>Event</span><select value={formState.eventType} onChange={(event) => setFormState((p) => ({ ...p, eventType: event.target.value as TaskEventType }))}>{Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="form__field"><span>Delay (s)</span><input type="number" min={0} value={formState.eventDelaySeconds} onChange={(event) => setFormState((p) => ({ ...p, eventDelaySeconds: Number(event.target.value) }))} /></label>
                    <label className="form__field"><span>Condition</span><select value={formState.requireOnlinePlayers} onChange={(event) => setFormState((p) => ({ ...p, requireOnlinePlayers: event.target.value as TaskFormState['requireOnlinePlayers'] }))}><option value="any">Any player state</option><option value="non_empty">Only when players online</option><option value="empty">Only when server empty</option></select></label>
                  </>
                )}
              </div>
            </fieldset>

            <fieldset className="form__fieldset">
              <legend>Action</legend>
              <div className="form__inline">
                <label className="form__field">
                  <span>Action Type</span>
                  <select value={formState.actionType} onChange={(event) => setFormState((p) => ({ ...p, actionType: event.target.value as TaskAction['type'] }))}>
                    <option value="lifecycle">Lifecycle</option>
                    <option value="command">Console command</option>
                    <option value="message">Server message</option>
                    <option value="message_then_command">Message + delayed command</option>
                  </select>
                </label>

                {formState.actionType === 'lifecycle' ? <label className="form__field"><span>Operation</span><select value={formState.lifecycleOperation} onChange={(event) => setFormState((p) => ({ ...p, lifecycleOperation: event.target.value as TaskFormState['lifecycleOperation'] }))}>{Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
                {formState.actionType === 'command' ? <label className="form__field"><span>Command</span><input type="text" value={formState.command} onChange={(event) => setFormState((p) => ({ ...p, command: event.target.value }))} placeholder="say Hallo {player}" /></label> : null}
                {formState.actionType === 'message' || formState.actionType === 'message_then_command' ? (
                  <>
                    <label className="form__field"><span>Message</span><input type="text" value={formState.message} onChange={(event) => setFormState((p) => ({ ...p, message: event.target.value }))} placeholder="Server restartet in 5 Minuten" /></label>
                    <label className="form__field"><span>Format</span><select value={formState.messageFormat} onChange={(event) => setFormState((p) => ({ ...p, messageFormat: event.target.value as TaskFormState['messageFormat'] }))}><option value="plain">Plain (say)</option><option value="legacy">Legacy/Tellraw Text</option><option value="json">JSON Tellraw</option></select></label>
                  </>
                ) : null}
                {formState.actionType === 'message_then_command' ? (
                  <>
                    <label className="form__field"><span>Then wait (s)</span><input type="number" min={0} value={formState.followUpDelaySeconds} onChange={(event) => setFormState((p) => ({ ...p, followUpDelaySeconds: Number(event.target.value) }))} /></label>
                    <label className="form__field"><span>Then command</span><input type="text" value={formState.followUpCommand} onChange={(event) => setFormState((p) => ({ ...p, followUpCommand: event.target.value }))} placeholder="restart" /></label>
                  </>
                ) : null}
              </div>
            </fieldset>

            <p className="page__hint">Platzhalter: {'{player}'}, {'{onlineCount}'}, {'{maxPlayers}'}</p>
            {error ? <div className="alert alert--error">{error}</div> : null}
          </div>

          <div className="actions actions--inline modal__footer">
            <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create task'}</button>
            <button className="btn btn--ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </ModalPortal>
  )
}

export function TasksPage() {
  const { id } = useParams()
  const { isInstanceWindow, instanceSearch } = useWindowContext()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalTask, setModalTask] = useState<ScheduledTask | undefined>(undefined)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)

  const refresh = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setTasks(await getInstanceTasks(id))
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [id])

  const handleSubmit = async (payload: CreateTaskPayload, existingId?: string) => {
    if (!id) return
    if (existingId) {
      const updated = await apiUpdateTask(existingId, payload)
      setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)))
      return
    }
    const created = await createInstanceTask(id, payload)
    setTasks((prev) => [...prev, created])
  }

  const handleToggle = async (task: ScheduledTask) => {
    setBusyTaskId(task.id)
    try {
      const updated = await apiUpdateTask(task.id, { enabled: !task.enabled })
      setTasks((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)))
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to toggle task')
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleDelete = async (task: ScheduledTask) => {
    const confirmed = window.confirm(`Delete task ${actionLabel(task.action)}?`)
    if (!confirmed) return
    setBusyTaskId(task.id)
    try {
      await apiDeleteTask(task.id)
      setTasks((prev) => prev.filter((entry) => entry.id !== task.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete task')
    } finally {
      setBusyTaskId(null)
    }
  }

  const nextRunBadge = useMemo(
    () => tasks.filter((task) => task.enabled && task.trigger.type === 'schedule' && task.nextRunAt).sort((a, b) => new Date(a.nextRunAt ?? 0).getTime() - new Date(b.nextRunAt ?? 0).getTime())[0],
    [tasks],
  )

  return (
    <section className="page">
      <div className="page__toolbar"><BackButton fallback={id ? `/instances/${id}/console${isInstanceWindow ? instanceSearch : ''}` : '/'} /></div>
      <div className="page__header page__header--spread">
        <div>
          <h1>Tasks</h1>
          <p className="page__hint">Schedule tasks and react to server/player events.</p>
          {id ? <p className="page__id">Instance {id}</p> : null}
        </div>
        <div className="actions actions--inline">
          <Link className="btn btn--ghost" to={{ pathname: `/instances/${id}/console`, search: isInstanceWindow ? instanceSearch : '' }}>Back to Console</Link>
          <button className="btn" onClick={() => { setModalTask(undefined); setIsModalOpen(true) }} disabled={!id}>New Task</button>
          <button className="btn btn--ghost" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {nextRunBadge ? <div className="alert alert--muted">Next scheduled task: {actionLabel(nextRunBadge.action)} at {formatDateTime(nextRunBadge.nextRunAt)}</div> : null}
      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="card__header"><strong>Tasks</strong>{loading ? <span className="badge badge--muted">Loading…</span> : null}</div>
        {tasks.length === 0 && !loading ? <p className="page__hint">No tasks configured yet.</p> : null}
        {tasks.length > 0 ? (
          <table className="table">
            <thead><tr><th>Trigger</th><th>Action</th><th>Next run</th><th>Last run</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{scheduleLabel(task.trigger)}</td>
                  <td><div className="table__cell-title">{actionLabel(task.action)}</div></td>
                  <td>{formatDateTime(task.nextRunAt)}</td>
                  <td>{formatDateTime(task.lastRunAt)}</td>
                  <td><div className="actions actions--inline"><span className={`badge badge--${task.enabled ? 'success' : 'muted'}`}>{task.enabled ? 'Enabled' : 'Disabled'}</span>{task.running ? <span className="badge badge--info">Running</span> : null}</div></td>
                  <td>
                    <div className="actions actions--inline">
                      <button className="btn btn--ghost" onClick={() => handleToggle(task)} disabled={busyTaskId === task.id}>{task.enabled ? 'Disable' : 'Enable'}</button>
                      <button className="btn btn--ghost" onClick={() => { setModalTask(task); setIsModalOpen(true) }}>Edit</button>
                      <button className="btn btn--secondary" onClick={() => handleDelete(task)} disabled={busyTaskId === task.id}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {isModalOpen ? <TaskModal initial={modalTask} onClose={() => setIsModalOpen(false)} onSubmit={handleSubmit} /> : null}
    </section>
  )
}

export default TasksPage
