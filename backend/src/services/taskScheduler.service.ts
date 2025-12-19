import { promises as fs } from 'fs'
import { InstanceManager } from '../core/InstanceManager'
import { LogService } from '../core/LogService'
import { ScheduledTask, TaskSchedule } from '../core/types'
import { getInstanceDir, getInstanceTasksPath } from '../config/paths'
import { instanceActionService } from './instanceActions.service'
import { logStreamService } from './logStream.service'

const MAX_MINUTE_LOOKAHEAD = 525600 // 1 year of minutes

const parseNumberList = (field: string, min: number, max: number): number[] | null => {
  const values = new Set<number>()

  const addRange = (start: number, end: number, step = 1) => {
    for (let value = start; value <= end; value += step) {
      values.add(value)
    }
  }

  const handleToken = (token: string) => {
    if (token === '*') {
      addRange(min, max)
      return
    }

    const stepMatch = token.match(/^\*\/(\d+)$/)
    if (stepMatch) {
      const step = Number.parseInt(stepMatch[1], 10)
      if (!Number.isFinite(step) || step <= 0) return
      addRange(min, max, step)
      return
    }

    const rangeMatch = token.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10)
      const end = Number.parseInt(rangeMatch[2], 10)
      if (!Number.isFinite(start) || !Number.isFinite(end)) return
      if (start > end || start < min || end > max) return
      addRange(start, end)
      return
    }

    const numeric = Number.parseInt(token, 10)
    if (Number.isFinite(numeric) && numeric >= min && numeric <= max) {
      values.add(numeric)
    }
  }

  for (const token of field.split(',')) {
    handleToken(token.trim())
  }

  if (values.size === 0) return null
  return Array.from(values).sort((a, b) => a - b)
}

const nextCronDate = (expression: string, fromDate = new Date()): Date | null => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const [minuteField, hourField, dayField, monthField, dayOfWeekField] = fields
  const minutes = parseNumberList(minuteField, 0, 59)
  const hours = parseNumberList(hourField, 0, 23)
  const days = parseNumberList(dayField, 1, 31)
  const months = parseNumberList(monthField, 1, 12)
  const daysOfWeek = parseNumberList(dayOfWeekField, 0, 6)

  if (!minutes || !hours || !days || !months || !daysOfWeek) return null

  const candidate = new Date(fromDate.getTime())
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  for (let i = 0; i < MAX_MINUTE_LOOKAHEAD; i += 1) {
    const month = candidate.getMonth() + 1
    const date = candidate.getDate()
    const dow = candidate.getDay()
    const minute = candidate.getMinutes()
    const hour = candidate.getHours()

    if (
      months.includes(month) &&
      days.includes(date) &&
      daysOfWeek.includes(dow) &&
      hours.includes(hour) &&
      minutes.includes(minute)
    ) {
      return new Date(candidate.getTime())
    }

    candidate.setMinutes(candidate.getMinutes() + 1)
  }

  return null
}

export const computeNextRun = (schedule: TaskSchedule, fromDate = new Date()): string | null => {
  if (schedule.mode === 'interval') {
    const minutes = Number(schedule.intervalMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return null
    return new Date(fromDate.getTime() + minutes * 60 * 1000).toISOString()
  }

  const nextDate = nextCronDate(schedule.expression, fromDate)
  return nextDate ? nextDate.toISOString() : null
}

class TaskRepository {
  private instanceManager = new InstanceManager()

  private async ensureInstanceDir(instanceId: string) {
    await fs.mkdir(getInstanceDir(instanceId), { recursive: true })
  }

  private async readTasks(instanceId: string): Promise<ScheduledTask[]> {
    await this.ensureInstanceDir(instanceId)
    const taskPath = getInstanceTasksPath(instanceId)
    try {
      const content = await fs.readFile(taskPath, 'utf-8')
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        return parsed as ScheduledTask[]
      }
      return []
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  private async writeTasks(instanceId: string, tasks: ScheduledTask[]) {
    await this.ensureInstanceDir(instanceId)
    const taskPath = getInstanceTasksPath(instanceId)
    await fs.writeFile(taskPath, JSON.stringify(tasks, null, 2), 'utf-8')
  }

  private attachNextRun(task: ScheduledTask, fromDate = new Date()): ScheduledTask {
    if (task.nextRunAt) return task
    const nextRunAt = computeNextRun(task.schedule, fromDate)
    return { ...task, nextRunAt }
  }

  async listTasks(instanceId: string): Promise<ScheduledTask[]> {
    const tasks = await this.readTasks(instanceId)
    const withNext = tasks.map((task) => this.attachNextRun(task))
    await this.writeTasks(instanceId, withNext)
    return withNext
  }

  async listAllTasks(): Promise<ScheduledTask[]> {
    const instances = await this.instanceManager.listInstances()
    const tasks: ScheduledTask[] = []
    for (const instance of instances) {
      const list = await this.listTasks(instance.id)
      tasks.push(...list)
    }
    return tasks
  }

  async createTask(instanceId: string, task: Omit<ScheduledTask, 'id' | 'nextRunAt' | 'lastRunAt'>) {
    const tasks = await this.listTasks(instanceId)
    const nextRunAt = computeNextRun(task.schedule)
    const newTask: ScheduledTask = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      lastRunAt: null,
      nextRunAt,
    }
    tasks.push(newTask)
    await this.writeTasks(instanceId, tasks)
    return newTask
  }

  private async findTask(taskId: string): Promise<
    | { instanceId: string; task: ScheduledTask; tasks: ScheduledTask[] }
    | null
  > {
    const instances = await this.instanceManager.listInstances()
    for (const instance of instances) {
      const tasks = await this.readTasks(instance.id)
      const found = tasks.find((entry) => entry.id === taskId)
      if (found) {
        return { instanceId: instance.id, task: this.attachNextRun(found), tasks }
      }
    }
    return null
  }

  async updateTask(taskId: string, partial: Partial<ScheduledTask>): Promise<ScheduledTask | null> {
    const located = await this.findTask(taskId)
    if (!located) return null

    const merged: ScheduledTask = {
      ...located.task,
      ...partial,
    }

    if (partial.schedule) {
      merged.nextRunAt = computeNextRun(partial.schedule)
    }

    const updatedTasks = located.tasks.map((task) =>
      task.id === taskId ? { ...merged, nextRunAt: merged.nextRunAt ?? task.nextRunAt } : task,
    )
    await this.writeTasks(located.instanceId, updatedTasks)
    return updatedTasks.find((task) => task.id === taskId) ?? null
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const located = await this.findTask(taskId)
    if (!located) return false
    const filtered = located.tasks.filter((task) => task.id !== taskId)
    await this.writeTasks(located.instanceId, filtered)
    return true
  }

  async recordRun(taskId: string, fromDate = new Date()): Promise<ScheduledTask | null> {
    const located = await this.findTask(taskId)
    if (!located) return null

    const lastRunAt = fromDate.toISOString()
    const nextRunAt = computeNextRun(located.task.schedule, fromDate)
    const updatedTasks = located.tasks.map((task) =>
      task.id === taskId ? { ...task, lastRunAt, nextRunAt } : task,
    )

    await this.writeTasks(located.instanceId, updatedTasks)
    return updatedTasks.find((task) => task.id === taskId) ?? null
  }
}

class TaskScheduler {
  private timer: NodeJS.Timeout | null = null

  private running = new Set<string>()

  constructor(private repository = new TaskRepository(), private logService = new LogService()) {}

  start() {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), 60 * 1000)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async emitLog(instanceId: string, message: string) {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [task] ${message}\n`
    await this.logService.appendLog(instanceId, line)
    logStreamService.emitLog(instanceId, line)
  }

  private async executeTask(task: ScheduledTask) {
    try {
      switch (task.type) {
        case 'backup':
          await this.emitLog(task.instanceId, 'Backup task triggered (TODO: hook implementation)')
          break
        case 'restart':
          await this.emitLog(task.instanceId, 'Scheduled restart requested')
          await instanceActionService.restart(task.instanceId)
          break
        case 'stop':
          await this.emitLog(task.instanceId, 'Scheduled stop requested')
          await instanceActionService.stop(task.instanceId)
          break
        case 'start':
          await this.emitLog(task.instanceId, 'Scheduled start requested')
          await instanceActionService.start(task.instanceId)
          break
        case 'command': {
          const command = task.payload?.command ?? ''
          await this.emitLog(task.instanceId, `Scheduled command: ${command || '<empty>'}`)
          await instanceActionService.sendCommand(task.instanceId, command)
          break
        }
        case 'sleep':
          await this.emitLog(task.instanceId, 'Scheduled sleep requested')
          await instanceActionService.stop(task.instanceId)
          break
        default:
          break
      }
    } catch (error) {
      await this.emitLog(task.instanceId, `Task ${task.id} failed: ${(error as Error)?.message ?? error}`)
    }
  }

  private async tick() {
    const now = Date.now()
    const tasks = await this.repository.listAllTasks()

    for (const task of tasks) {
      if (!task.enabled) continue
      if (this.running.has(task.id)) continue
      if (!task.nextRunAt) continue

      const nextRun = new Date(task.nextRunAt).getTime()
      if (Number.isNaN(nextRun)) continue
      if (nextRun > now + 1000) continue

      this.running.add(task.id)
      this.executeTask(task)
        .finally(async () => {
          await this.repository.recordRun(task.id, new Date())
          this.running.delete(task.id)
        })
        .catch(() => {
          this.running.delete(task.id)
        })
    }
  }

  async getTasksForInstance(instanceId: string): Promise<ScheduledTask[]> {
    const tasks = await this.repository.listTasks(instanceId)
    return tasks.map((task) => ({ ...task, running: this.running.has(task.id) }))
  }

  async createTask(instanceId: string, task: Omit<ScheduledTask, 'id' | 'nextRunAt' | 'lastRunAt'>) {
    return this.repository.createTask(instanceId, task)
  }

  async updateTask(taskId: string, partial: Partial<ScheduledTask>) {
    return this.repository.updateTask(taskId, partial)
  }

  async deleteTask(taskId: string) {
    return this.repository.deleteTask(taskId)
  }
}

export const taskScheduler = new TaskScheduler()
