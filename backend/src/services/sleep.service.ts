import { InstanceManager } from '../core/InstanceManager'
import { LogService } from '../core/LogService'
import { InstanceConfig, SleepSettings } from '../core/types'
import { instanceActionService } from './instanceActions.service'
import { getRuntimeInfo, recordActivity, setStopInProgress, updateStatus } from './runtimeState.service'
import { processManager } from './processManager.service'

const DEFAULT_SETTINGS: Required<SleepSettings> = {
  sleepEnabled: false,
  idleMinutes: 15,
  wakeOnPing: true,
  wakeGraceSeconds: 60,
  stopMethod: 'graceful',
}

const MINUTE = 60 * 1000

class SleepService {
  private instanceManager = new InstanceManager()
  private logService = new LogService()
  private timer: NodeJS.Timeout | null = null
  private stopLocks = new Set<string>()
  private startLocks = new Set<string>()
  private cooldown = new Map<string, number>()
  private wakeCooldown = new Map<string, number>()

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick().catch((error) => console.error('sleep tick error', error)), MINUTE)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private getSettings(instance: InstanceConfig): Required<SleepSettings> {
    const merged = { ...DEFAULT_SETTINGS, ...(instance.sleep ?? {}) }
    const idleMinutes = Number.isFinite(merged.idleMinutes) ? Math.max(1, merged.idleMinutes) : DEFAULT_SETTINGS.idleMinutes
    const wakeGraceSeconds = Number.isFinite(merged.wakeGraceSeconds)
      ? Math.max(10, merged.wakeGraceSeconds)
      : DEFAULT_SETTINGS.wakeGraceSeconds
    return { ...merged, idleMinutes, wakeGraceSeconds }
  }

  private async tick() {
    const instances = await this.instanceManager.listInstances()
    for (const instance of instances) {
      const settings = this.getSettings(instance)
      if (!settings.sleepEnabled) continue
      await this.checkInstance(instance.id, settings)
    }
  }

  private async log(instanceId: string, message: string) {
    const line = `[sleep] ${message}\n`
    await this.logService.appendLog(instanceId, line)
  }

  private async checkInstance(instanceId: string, settings: Required<SleepSettings>) {
    const runtime = getRuntimeInfo(instanceId)
    if (runtime.status !== 'running') return

    const now = Date.now()
    const onlinePlayers = typeof runtime.onlinePlayers === 'number' ? runtime.onlinePlayers : null
    if (onlinePlayers && onlinePlayers > 0) {
      recordActivity(instanceId)
      return
    }

    const lastActivity = runtime.lastActivityAt ?? runtime.startedAt ?? now
    const idleForMinutes = (now - lastActivity) / MINUTE

    if (idleForMinutes < settings.idleMinutes) return

    const nextAllowed = this.cooldown.get(instanceId) ?? 0
    if (now < nextAllowed) {
      const remaining = Math.max(0, Math.round((nextAllowed - now) / 1000))
      await this.log(instanceId, `sleep.cooldown - stop blocked for ${remaining}s`)
      return
    }

    if (this.stopLocks.has(instanceId)) return

    this.stopLocks.add(instanceId)
    setStopInProgress(instanceId, true)
    this.cooldown.set(instanceId, now + settings.wakeGraceSeconds * 1000)
    await this.log(instanceId, 'sleep.enter - idle threshold reached, preparing shutdown')
    try {
      await this.log(instanceId, 'sleep.stop.start - stopping idle server')
      const stopTimeout = Math.max(settings.wakeGraceSeconds * 1000, 10000)
      const graceful = await processManager.stopGracefully(instanceId, stopTimeout)
      if (!graceful && processManager.isRunning(instanceId)) {
        await this.log(instanceId, 'sleep.stop.start - graceful failed, forcing process kill')
        await processManager.stop(instanceId)
      }
      updateStatus(instanceId, 'stopped', null)
      await this.log(instanceId, 'sleep.stop.success - server halted after idle period')
    } catch (error) {
      console.error('sleep stop failed', error)
      await this.log(instanceId, 'sleep.stop.fail - unable to stop idle server')
    } finally {
      setStopInProgress(instanceId, false)
      this.stopLocks.delete(instanceId)
    }
  }

  async getSettingsForInstance(id: string) {
    const instance = await this.instanceManager.getInstance(id)
    if (!instance) return null
    return this.getSettings(instance)
  }

  async updateSettings(id: string, partial: Partial<SleepSettings>) {
    const instance = await this.instanceManager.getInstance(id)
    if (!instance) return null
    const merged = { ...this.getSettings(instance), ...partial }
    const updated = await this.instanceManager.updateInstance(id, { ...instance, sleep: merged })
    return this.getSettings(updated)
  }

  async getStatus(id: string) {
    const instance = await this.instanceManager.getInstance(id)
    if (!instance) return null
    const settings = this.getSettings(instance)
    const runtime = getRuntimeInfo(id)
    const now = Date.now()
    const lastActivityAt = runtime.lastActivityAt ?? runtime.startedAt
    const idleForMs = lastActivityAt ? now - lastActivityAt : null
    return {
      enabled: settings.sleepEnabled,
      idleFor: idleForMs,
      lastActivityAt,
      stopInProgress: runtime.stopInProgress ?? false,
      startInProgress: runtime.startInProgress ?? false,
      proxyStatus: settings.sleepEnabled ? 'idle' : 'disabled',
      onlinePlayers: runtime.onlinePlayers ?? null,
    }
  }

  async wake(id: string) {
    const runtime = getRuntimeInfo(id)
    const now = Date.now()
    const blockedUntil = this.wakeCooldown.get(id) ?? 0
    if (now < blockedUntil) {
      return { status: 'cooldown' as const }
    }

    if (runtime.status === 'running' || processManager.isRunning(id)) {
      return { status: 'already_running' as const }
    }
    if (this.startLocks.has(id)) {
      return { status: 'starting' as const }
    }
    this.startLocks.add(id)
    await this.log(id, 'sleep.wake.start - incoming wake request')
    try {
      await instanceActionService.start(id)
      recordActivity(id)
      await this.log(id, 'sleep.wake.ready - server started')
      return { status: 'started' as const }
    } catch (error) {
      this.wakeCooldown.set(id, now + 30 * 1000)
      await this.log(id, 'sleep.stop.fail - failed to wake server, entering cooldown')
      throw error
    } finally {
      this.startLocks.delete(id)
    }
  }
}

export const sleepService = new SleepService()
