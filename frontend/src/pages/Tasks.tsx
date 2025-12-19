import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CreateTaskPayload,
  ScheduledTask,
  TaskSchedule,
  TaskType,
  createInstanceTask,
  deleteTask as apiDeleteTask,
  getInstanceTasks,
  updateTask as apiUpdateTask,
} from '../api'

const taskTypeLabels: Record<TaskType, string> = {
  backup: 'Backup',
  restart: 'Restart',
  stop: 'Stop',
  start: 'Start',
  command: 'Command',
  sleep: 'Force Sleep',
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '—'
  try {
    const date = new Date(value)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
  } catch (error) {
    return '—'
  }
}

interface TaskFormState {
  type: TaskType
  enabled: boolean
  mode: 'interval' | 'daily' | 'weekly' | 'cron'
  intervalValue: number
  intervalUnit: 'minutes' | 'hours'
  timeOfDay: string
  dayOfWeek: string
  cronExpression: string
  command: string
}

const defaultFormState: TaskFormState = {
  type: 'restart',
  enabled: true,
  mode: 'interval',
  intervalValue: 6,
  intervalUnit: 'hours',
  timeOfDay: '04:00',
  dayOfWeek: '0',
  cronExpression: '0 4 * * *',
  command: '',
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
      return state.cronExpression.trim()
        ? { mode: 'cron', expression: state.cronExpression.trim() }
        : null
    default:
      return null
  }
}

const scheduleLabel = (task: ScheduledTask) => {
  if (task.schedule.mode === 'interval') {
    const hours = task.schedule.intervalMinutes / 60
    if (Number.isInteger(hours)) {
      return `Every ${hours}h`
    }
    return `Every ${task.schedule.intervalMinutes}m`
  }
  return task.schedule.expression
}

const deriveFormState = (task?: ScheduledTask): TaskFormState => {
  if (!task) return defaultFormState

  if (task.schedule.mode === 'interval') {
    const intervalValue =
      task.schedule.intervalMinutes % 60 === 0
        ? task.schedule.intervalMinutes / 60
        : task.schedule.intervalMinutes
    const intervalUnit = task.schedule.intervalMinutes % 60 === 0 ? 'hours' : 'minutes'

    return {
      ...defaultFormState,
      type: task.type,
      enabled: task.enabled,
      mode: 'interval',
      intervalValue,
      intervalUnit,
      command: task.payload?.command ?? '',
    }
  }

  return {
    ...defaultFormState,
    type: task.type,
    enabled: task.enabled,
    mode: 'cron',
    cronExpression: task.schedule.expression,
    command: task.payload?.command ?? '',
  }
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

    const schedule = buildSchedule(formState)
    if (!schedule) {
      setError('Please provide a valid schedule')
      return
    }

    if (formState.type === 'command' && !formState.command.trim()) {
      setError('Command is required for command tasks')
      return
    }

    const payload: CreateTaskPayload = {
      type: formState.type,
      enabled: formState.enabled,
      schedule,
      payload: formState.type === 'command' ? { command: formState.command.trim() } : undefined,
    }

    setSaving(true)
    try {
      await onSubmit(payload, initial?.id)
      onClose()
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to save task'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <div>
            <h2>{initial ? 'Edit Task' : 'Create Task'}</h2>
            <p className="page__hint">Automate lifecycle actions for this instance.</p>
          </div>
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label className="form__field">
            <span>Task Type</span>
            <select
              value={formState.type}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, type: event.target.value as TaskType }))
              }
            >
              {Object.entries(taskTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="form__field">
            <span>Enabled</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={formState.enabled}
                onChange={(event) => setFormState((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              Toggle
            </label>
          </label>

          <fieldset className="form__fieldset">
            <legend>Schedule</legend>
            <div className="form__inline">
              <label className="form__field">
                <span>Mode</span>
                <select
                  value={formState.mode}
                  onChange={(event) => setFormState((prev) => ({ ...prev, mode: event.target.value as TaskFormState['mode'] }))}
                >
                  <option value="interval">Every X minutes/hours</option>
                  <option value="daily">Daily at</option>
                  <option value="weekly">Weekly</option>
                  <option value="cron">Advanced cron</option>
                </select>
              </label>

              {formState.mode === 'interval' ? (
                <>
                  <label className="form__field">
                    <span>Every</span>
                    <input
                      type="number"
                      min={1}
                      value={formState.intervalValue}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, intervalValue: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <label className="form__field">
                    <span>Unit</span>
                    <select
                      value={formState.intervalUnit}
                      onChange={(event) =>
                        setFormState((prev) => ({ ...prev, intervalUnit: event.target.value as TaskFormState['intervalUnit'] }))
                      }
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                    </select>
                  </label>
                </>
              ) : null}

              {formState.mode === 'daily' || formState.mode === 'weekly' ? (
                <label className="form__field">
                  <span>Time (HH:MM)</span>
                  <input
                    type="time"
                    value={formState.timeOfDay}
                    onChange={(event) => setFormState((prev) => ({ ...prev, timeOfDay: event.target.value }))}
                  />
                </label>
              ) : null}

              {formState.mode === 'weekly' ? (
                <label className="form__field">
                  <span>Day of week</span>
                  <select
                    value={formState.dayOfWeek}
                    onChange={(event) => setFormState((prev) => ({ ...prev, dayOfWeek: event.target.value }))}
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </label>
              ) : null}

              {formState.mode === 'cron' ? (
                <label className="form__field">
                  <span>Cron expression</span>
                  <input
                    type="text"
                    placeholder="0 4 * * *"
                    value={formState.cronExpression}
                    onChange={(event) => setFormState((prev) => ({ ...prev, cronExpression: event.target.value }))}
                  />
                  <small className="page__hint">Minute Hour Day Month DayOfWeek</small>
                </label>
              ) : null}
            </div>
          </fieldset>

          {formState.type === 'command' ? (
            <label className="form__field">
              <span>Command</span>
              <input
                type="text"
                value={formState.command}
                onChange={(event) => setFormState((prev) => ({ ...prev, command: event.target.value }))}
                placeholder="save-all"
              />
              <small className="page__hint">Sent only when the server is running.</small>
            </label>
          ) : null}

          <p className="page__hint">Tasks may interrupt players when they restart, stop or sleep the server.</p>

          {error ? <div className="alert alert--error">{error}</div> : null}

          <div className="actions actions--inline">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Create task'}
            </button>
            <button className="btn btn--ghost" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function TasksPage() {
  const { id } = useParams()
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
      const list = await getInstanceTasks(id)
      setTasks(list)
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Failed to load tasks'
      setError(message)
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
      const message = toggleError instanceof Error ? toggleError.message : 'Failed to toggle task'
      setError(message)
    } finally {
      setBusyTaskId(null)
    }
  }

  const handleDelete = async (task: ScheduledTask) => {
    const confirmed = window.confirm(`Delete task ${taskTypeLabels[task.type]}?`)
    if (!confirmed) return
    setBusyTaskId(task.id)
    try {
      await apiDeleteTask(task.id)
      setTasks((prev) => prev.filter((entry) => entry.id !== task.id))
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Failed to delete task'
      setError(message)
    } finally {
      setBusyTaskId(null)
    }
  }

  const openCreate = () => {
    setModalTask(undefined)
    setIsModalOpen(true)
  }

  const openEdit = (task: ScheduledTask) => {
    setModalTask(task)
    setIsModalOpen(true)
  }

  const nextRunBadge = useMemo(
    () =>
      tasks
        .filter((task) => task.enabled && task.nextRunAt)
        .sort((a, b) => new Date(a.nextRunAt ?? 0).getTime() - new Date(b.nextRunAt ?? 0).getTime())[0],
    [tasks],
  )

  return (
    <section className="page">
      <div className="page__header page__header--spread">
        <div>
          <h1>Scheduled Tasks</h1>
          <p className="page__hint">Automate backups, restarts, sleeps, and commands for this server.</p>
          {id ? <p className="page__id">Instance {id}</p> : null}
        </div>
        <div className="actions actions--inline">
          <Link className="btn btn--ghost" to={`/instances/${id}/console`}>
            Back to Console
          </Link>
          <button className="btn" onClick={openCreate} disabled={!id}>
            New Task
          </button>
          <button className="btn btn--ghost" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {nextRunBadge ? (
        <div className="alert alert--muted">
          Next task: {taskTypeLabels[nextRunBadge.type]} at {formatDateTime(nextRunBadge.nextRunAt)}
        </div>
      ) : null}

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="card__header">
          <strong>Tasks</strong>
          {loading ? <span className="badge badge--muted">Loading…</span> : null}
        </div>
        {tasks.length === 0 && !loading ? (
          <p className="page__hint">No tasks configured yet.</p>
        ) : null}
        {tasks.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Schedule</th>
                <th>Next run</th>
                <th>Last run</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>
                    <div className="table__cell-title">{taskTypeLabels[task.type]}</div>
                    {task.type === 'command' && task.payload?.command ? (
                      <div className="page__hint">{task.payload.command}</div>
                    ) : null}
                  </td>
                  <td>{scheduleLabel(task)}</td>
                  <td>{formatDateTime(task.nextRunAt)}</td>
                  <td>{formatDateTime(task.lastRunAt)}</td>
                  <td>
                    <div className="actions actions--inline">
                      <span className={`badge badge--${task.enabled ? 'success' : 'muted'}`}>
                        {task.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {task.running ? <span className="badge badge--info">Running</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="actions actions--inline">
                      <button
                        className="btn btn--ghost"
                        onClick={() => handleToggle(task)}
                        disabled={busyTaskId === task.id}
                      >
                        {task.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn--ghost" onClick={() => openEdit(task)}>
                        Edit
                      </button>
                      <button
                        className="btn btn--secondary"
                        onClick={() => handleDelete(task)}
                        disabled={busyTaskId === task.id}
                      >
                        Delete
                      </button>
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
