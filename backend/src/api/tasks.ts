import { Request, Response, Router } from 'express'
import { InstanceManager } from '../core/InstanceManager'
import { ScheduledTask, TaskSchedule, TaskType } from '../core/types'
import { computeNextRun, taskScheduler } from '../services/taskScheduler.service'

const router = Router()
const instanceManager = new InstanceManager()

const parseSchedule = (input: any): TaskSchedule | null => {
  if (input && typeof input === 'object') {
    if (input.mode === 'interval') {
      const minutes = Number(input.intervalMinutes)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      return { mode: 'interval', intervalMinutes: minutes }
    }
    if (input.mode === 'cron' && typeof input.expression === 'string' && input.expression.trim()) {
      return { mode: 'cron', expression: input.expression.trim() }
    }
  }
  return null
}

const parseTaskType = (value: any): TaskType | null => {
  const allowed: TaskType[] = ['backup', 'restart', 'stop', 'start', 'command', 'sleep']
  if (typeof value !== 'string') return null
  if (allowed.includes(value as TaskType)) return value as TaskType
  return null
}

router.get('/instances/:id/tasks', async (req: Request, res: Response) => {
  const { id } = req.params
  const instance = await instanceManager.getInstance(id)
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' })
  }

  try {
    const tasks = await taskScheduler.getTasksForInstance(id)
    return res.json({ id, tasks })
  } catch (error) {
    console.error(`Failed to list tasks for ${id}`, error)
    return res.status(500).json({ error: 'Failed to list tasks' })
  }
})

router.post('/instances/:id/tasks', async (req: Request, res: Response) => {
  const { id } = req.params
  const instance = await instanceManager.getInstance(id)
  if (!instance) {
    return res.status(404).json({ error: 'Instance not found' })
  }

  const schedule = parseSchedule(req.body?.schedule)
  const type = parseTaskType(req.body?.type)
  const enabled = req.body?.enabled !== false
  const payload = req.body?.payload

  if (!schedule || !type) {
    return res.status(400).json({ error: 'Invalid type or schedule' })
  }

  if (type === 'command') {
    const command = typeof payload?.command === 'string' ? payload.command.trim() : ''
    if (!command) {
      return res.status(400).json({ error: 'command payload is required for command tasks' })
    }
  }

  try {
    const task = await taskScheduler.createTask(id, {
      instanceId: id,
      enabled,
      type,
      payload,
      schedule,
    })

    return res.status(201).json({ task })
  } catch (error) {
    console.error(`Failed to create task for ${id}`, error)
    return res.status(500).json({ error: 'Failed to create task' })
  }
})

router.put('/tasks/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params
  const partial: Partial<ScheduledTask> = {}

  if (req.body?.enabled !== undefined) {
    partial.enabled = Boolean(req.body.enabled)
  }

  if (req.body?.type !== undefined) {
    const type = parseTaskType(req.body.type)
    if (!type) return res.status(400).json({ error: 'Invalid task type' })
    partial.type = type
  }

  if (req.body?.schedule !== undefined) {
    const schedule = parseSchedule(req.body.schedule)
    if (!schedule) return res.status(400).json({ error: 'Invalid schedule' })
    partial.schedule = schedule
    partial.nextRunAt = computeNextRun(schedule)
  }

  if (req.body?.payload !== undefined) {
    partial.payload = req.body.payload
  }

  const effectiveType = partial.type ?? undefined
  if ((effectiveType === 'command' || partial.payload?.command !== undefined) && partial.payload) {
    const command = typeof partial.payload.command === 'string' ? partial.payload.command.trim() : ''
    if (!command) {
      return res.status(400).json({ error: 'command payload is required for command tasks' })
    }
  }

  try {
    const updated = await taskScheduler.updateTask(taskId, partial)
    if (!updated) {
      return res.status(404).json({ error: 'Task not found' })
    }
    return res.json({ task: updated })
  } catch (error) {
    console.error(`Failed to update task ${taskId}`, error)
    return res.status(500).json({ error: 'Failed to update task' })
  }
})

router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params
  try {
    const deleted = await taskScheduler.deleteTask(taskId)
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' })
    }
    return res.status(204).end()
  } catch (error) {
    console.error(`Failed to delete task ${taskId}`, error)
    return res.status(500).json({ error: 'Failed to delete task' })
  }
})

export default router
