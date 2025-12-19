import { promises as fs } from 'fs'
import path from 'path'
import { InstanceManager } from '../core/InstanceManager'
import { PlayerActionError } from '../core/PlayerActionError'
import { LogService } from '../core/LogService'
import { getInstanceServerDir } from '../config/paths'
import { processManager } from './processManager.service'
import { logStreamService } from './logStream.service'
import { rconService } from './rcon.service'

const WHITELIST_FILENAME = 'whitelist.json'
const BANNED_PLAYERS_FILENAME = 'banned-players.json'
const RATE_LIMIT_MS = 750

interface WhitelistEntry {
  uuid?: string | null
  name: string
}

interface OnlinePlayersResult {
  id: string
  players: string[]
  online: number | null
  max: number | null
  source: 'rcon' | 'logs' | 'unavailable'
  raw?: string
}

class InstanceRateLimiter {
  private lastCommands = new Map<string, number>()

  consume(id: string) {
    const now = Date.now()
    const last = this.lastCommands.get(id) ?? 0
    const diff = now - last
    if (diff < RATE_LIMIT_MS) {
      return { ok: false, retryAfterMs: RATE_LIMIT_MS - diff }
    }
    this.lastCommands.set(id, now)
    return { ok: true, retryAfterMs: 0 }
  }
}

export class PlayerService {
  private instanceManager = new InstanceManager()
  private logService = new LogService()
  private rateLimiter = new InstanceRateLimiter()

  private getWhitelistPath(id: string) {
    return path.join(getInstanceServerDir(id), WHITELIST_FILENAME)
  }

  private getBannedPlayersPath(id: string) {
    return path.join(getInstanceServerDir(id), BANNED_PLAYERS_FILENAME)
  }

  private async ensureInstance(id: string) {
    const instance = await this.instanceManager.getInstance(id)
    if (!instance) {
      throw new PlayerActionError(404, { error: 'Instance not found' })
    }
    return instance
  }

  private ensureRunning(id: string) {
    if (!processManager.isRunning(id)) {
      throw new PlayerActionError(409, { error: 'Instance not running' })
    }
  }

  private sanitizeName(name: string) {
    return name.trim().slice(0, 32)
  }

  private async logAction(id: string, message: string) {
    const timestamp = new Date().toISOString()
    const line = `[${timestamp}] [panel] ${message}\n`
    await this.logService.appendLog(id, line)
    logStreamService.emitLog(id, line)
  }

  private parseListResponse(raw: string): Omit<OnlinePlayersResult, 'id' | 'source'> | null {
    const normalized = raw.replace(/\n/g, ' ').trim()
    const listRegexes = [
      /There (?:are|is) (\d+) of a max of (\d+) players online:?\s*(.*)/i,
      /Players online: (\d+)\/(\d+):?\s*(.*)/i,
    ]

    for (const regex of listRegexes) {
      const match = normalized.match(regex)
      if (!match) continue
      const online = Number.parseInt(match[1], 10)
      const max = Number.parseInt(match[2], 10)
      const namesRaw = match[3]?.trim() ?? ''
      const players = namesRaw.length > 0 ? namesRaw.split(/,\s*/).filter(Boolean) : []
      return { players, online, max }
    }
    return null
  }

  private async parseFromLogs(id: string): Promise<OnlinePlayersResult> {
    const tail = await this.logService.readTail(id, 400)
    const lines = tail.split(/\r?\n/).filter(Boolean).reverse()
    for (const line of lines) {
      const parsed = this.parseListResponse(line)
      if (parsed) {
        return { ...parsed, id, source: 'logs', raw: line }
      }
    }
    return { id, players: [], online: null, max: null, source: 'unavailable' }
  }

  private ensureRateLimit(id: string) {
    const result = this.rateLimiter.consume(id)
    if (!result.ok) {
      throw new PlayerActionError(429, {
        error: 'Command rate limited for this instance',
        retryAfterMs: result.retryAfterMs,
      })
    }
  }

  private async sendViaConsole(id: string, command: string): Promise<'console'> {
    const sent = processManager.sendCommand(id, command)
    if (!sent) {
      throw new PlayerActionError(409, { error: 'Instance not running' })
    }
    return 'console'
  }

  private async runCommand(
    instanceId: string,
    command: string,
    actionLabel: string,
    meta?: Record<string, string | undefined>,
  ) {
    this.ensureRateLimit(instanceId)
    this.ensureRunning(instanceId)

    let method: 'rcon' | 'console' = 'console'
    const metaPairs = Object.entries(meta ?? {})
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')

    if ((await this.instanceManager.getInstance(instanceId))?.rconEnabled) {
      try {
        await rconService.sendCommand(instanceId, command)
        method = 'rcon'
      } catch (error) {
        if (error instanceof PlayerActionError && error.status === 401) {
          throw error
        }
        method = await this.sendViaConsole(instanceId, command)
      }
    } else {
      method = await this.sendViaConsole(instanceId, command)
    }

    await this.logAction(
      instanceId,
      `${actionLabel} actor=local ${metaPairs} via=${method} command="${command}"`.trim(),
    )

    return method
  }

  async getOnlinePlayers(id: string): Promise<OnlinePlayersResult> {
    const instance = await this.ensureInstance(id)
    this.ensureRunning(id)

    if (instance.rconEnabled) {
      try {
        const response = await rconService.sendCommand(id, 'list')
        const parsed = this.parseListResponse(response)
        if (parsed) {
          return { ...parsed, id, source: 'rcon', raw: response }
        }
      } catch (error) {
        if (error instanceof PlayerActionError && error.status === 401) {
          throw error
        }
      }
    }

    return this.parseFromLogs(id)
  }

  async kick(id: string, nameRaw: string, reason?: string) {
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const command = reason?.trim() ? `kick ${name} ${reason}` : `kick ${name}`
    const method = await this.runCommand(id, command, 'player.kick', { target: name, reason })
    return { id, ok: true, method }
  }

  async ban(id: string, nameRaw: string, reason?: string) {
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const command = reason?.trim() ? `ban ${name} ${reason}` : `ban ${name}`
    const method = await this.runCommand(id, command, 'player.ban', { target: name, reason })
    return { id, ok: true, method }
  }

  async unban(id: string, nameRaw: string) {
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const method = await this.runCommand(id, `pardon ${name}`, 'player.unban', { target: name })
    return { id, ok: true, method }
  }

  private async readWhitelist(id: string): Promise<WhitelistEntry[]> {
    const filePath = this.getWhitelistPath(id)
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry) => typeof entry?.name === 'string')
          .map((entry) => ({ uuid: typeof entry.uuid === 'string' ? entry.uuid : null, name: entry.name }))
      }
      return []
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  private async writeWhitelist(id: string, entries: WhitelistEntry[]): Promise<void> {
    const filePath = this.getWhitelistPath(id)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8')
  }

  async listWhitelist(id: string) {
    await this.ensureInstance(id)
    this.ensureRunning(id)
    const entries = await this.readWhitelist(id)
    return { id, entries }
  }

  async addToWhitelist(id: string, nameRaw: string) {
    const instance = await this.ensureInstance(id)
    this.ensureRunning(id)
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const existing = await this.readWhitelist(id)
    if (existing.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new PlayerActionError(409, { error: 'Player already whitelisted' })
    }

    const updated = [...existing, { name }]
    await this.writeWhitelist(id, updated)

    let commandDispatched = false
    if (processManager.isRunning(id)) {
      await this.runCommand(id, `whitelist add ${name}`, 'player.whitelist.add', { target: name })
      commandDispatched = true
    }

    if (!processManager.isRunning(id)) {
      await this.logAction(
        id,
        `player.whitelist.add actor=local target=${name} via=file command="whitelist add ${name}"`,
      )
    }

    return { id, entries: updated, syncedWithServer: commandDispatched && instance.rconEnabled !== false }
  }

  async removeFromWhitelist(id: string, nameRaw: string) {
    const instance = await this.ensureInstance(id)
    this.ensureRunning(id)
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const existing = await this.readWhitelist(id)
    const remaining = existing.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase())
    if (remaining.length === existing.length) {
      throw new PlayerActionError(404, { error: 'Player not found in whitelist' })
    }

    await this.writeWhitelist(id, remaining)

    let commandDispatched = false
    if (processManager.isRunning(id)) {
      await this.runCommand(id, `whitelist remove ${name}`, 'player.whitelist.remove', { target: name })
      commandDispatched = true
    }

    if (!processManager.isRunning(id)) {
      await this.logAction(
        id,
        `player.whitelist.remove actor=local target=${name} via=file command="whitelist remove ${name}"`,
      )
    }

    return { id, entries: remaining, syncedWithServer: commandDispatched && instance.rconEnabled !== false }
  }

  async op(id: string, nameRaw: string) {
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const method = await this.runCommand(id, `op ${name}`, 'player.op', { target: name })
    return { id, ok: true, method }
  }

  async deop(id: string, nameRaw: string) {
    const name = this.sanitizeName(nameRaw)
    if (!name) {
      throw new PlayerActionError(400, { error: 'Player name is required' })
    }

    const method = await this.runCommand(id, `deop ${name}`, 'player.deop', { target: name })
    return { id, ok: true, method }
  }

  async listBans(id: string) {
    const instance = await this.ensureInstance(id)
    this.ensureRunning(id)

    if (instance.rconEnabled && processManager.isRunning(id)) {
      try {
        const response = await rconService.sendCommand(id, 'banlist')
        const afterColon = response.split(':').slice(1).join(':').trim()
        const names = afterColon.length > 0 ? afterColon.split(/,\s*/).filter(Boolean) : []
        return { id, entries: names, source: 'rcon', raw: response }
      } catch (error) {
        if (error instanceof PlayerActionError && error.status === 401) {
          throw error
        }
      }
    }

    const filePath = this.getBannedPlayersPath(id)
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      const names = Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry?.name === 'string').map((entry) => entry.name as string)
        : []
      return { id, entries: names, source: 'file' as const }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { id, entries: [], source: 'file' as const }
      }
      throw error
    }
  }
}

export const playerService = new PlayerService()
