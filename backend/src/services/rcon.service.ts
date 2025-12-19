import { promises as fs } from 'fs'
import path from 'path'
import { Rcon } from 'rcon-client'
import { apply } from '../core/PropertiesFile'
import { PlayerActionError } from '../core/PlayerActionError'
import { InstanceManager } from '../core/InstanceManager'
import { InstanceConfig } from '../core/types'
import { getInstanceServerDir } from '../config/paths'

const SERVER_PROPERTIES_FILE = 'server.properties'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 25575
const COMMAND_TIMEOUT_MS = 5000

interface RconConnection {
  client: Rcon
}

export class RconService {
  private instanceManager = new InstanceManager()
  private connections = new Map<string, RconConnection>()
  private connecting = new Map<string, Promise<Rcon>>()

  private getServerPropertiesPath(instanceId: string) {
    return path.join(getInstanceServerDir(instanceId), SERVER_PROPERTIES_FILE)
  }

  private ensurePassword(instance: InstanceConfig) {
    const password = instance.rconPassword ?? ''
    if (!password.trim()) {
      throw new PlayerActionError(409, { error: 'RCON password not configured for this instance' })
    }
    return password
  }

  private async ensureRconProperties(instanceId: string, instance: InstanceConfig) {
    const password = this.ensurePassword(instance)
    const port = instance.rconPort ?? DEFAULT_PORT

    const filePath = this.getServerPropertiesPath(instanceId)
    let existing = ''

    try {
      existing = await fs.readFile(filePath, 'utf-8')
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    const updated = apply(
      existing,
      {
        'enable-rcon': 'true',
        'rcon.password': password,
        'rcon.port': String(port),
      },
      [],
    )

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, updated, 'utf-8')
  }

  private async getInstanceOrThrow(id: string): Promise<InstanceConfig> {
    const instance = await this.instanceManager.getInstance(id)
    if (!instance) {
      throw new PlayerActionError(404, { error: 'Instance not found' })
    }
    if (!instance.rconEnabled) {
      throw new PlayerActionError(409, { error: 'RCON disabled for this instance' })
    }
    return instance
  }

  private async establishConnection(instanceId: string, instance: InstanceConfig): Promise<Rcon> {
    const host = instance.rconHost || DEFAULT_HOST
    const port = instance.rconPort ?? DEFAULT_PORT
    const password = this.ensurePassword(instance)

    await this.ensureRconProperties(instanceId, instance)

    const client = new Rcon({ host, port, password, timeout: COMMAND_TIMEOUT_MS })

    client.on('end', () => {
      this.connections.delete(instanceId)
    })

    client.on('error', () => {
      this.connections.delete(instanceId)
    })

    await client.connect()
    this.connections.set(instanceId, { client })
    return client
  }

  private async getClient(instanceId: string): Promise<Rcon> {
    const instance = await this.getInstanceOrThrow(instanceId)

    const existing = this.connections.get(instanceId)
    if (existing) {
      return existing.client
    }

    const inflight = this.connecting.get(instanceId)
    if (inflight) {
      return inflight
    }

    const connectPromise = this.establishConnection(instanceId, instance).catch((error) => {
      this.connecting.delete(instanceId)
      this.connections.delete(instanceId)
      throw error
    })

    this.connecting.set(instanceId, connectPromise)

    try {
      const client = await connectPromise
      return client
    } finally {
      this.connecting.delete(instanceId)
    }
  }

  private handleError(error: any): never {
    const message = typeof error?.message === 'string' ? error.message : 'Unknown RCON error'
    const code = typeof error?.code === 'string' ? error.code : ''
    const lower = message.toLowerCase()

    if (lower.includes('auth') || lower.includes('authentication')) {
      throw new PlayerActionError(401, { error: 'RCON authentication failed' })
    }

    if (lower.includes('timeout') || code === 'ETIMEDOUT') {
      throw new PlayerActionError(504, { error: 'RCON request timed out' })
    }

    if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
      throw new PlayerActionError(503, { error: 'RCON connection refused (server offline?)' })
    }

    throw new PlayerActionError(502, { error: 'Failed to run command via RCON', details: message })
  }

  async sendCommand(instanceId: string, command: string): Promise<string> {
    try {
      const client = await this.getClient(instanceId)
      const response = await client.send(command)
      return response ?? ''
    } catch (error) {
      this.connections.delete(instanceId)
      this.handleError(error)
    }
  }

  async testConnection(instanceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.sendCommand(instanceId, 'list')
      return { ok: true }
    } catch (error) {
      const message = error instanceof PlayerActionError && error.body?.error
      return { ok: false, error: message || 'Failed to connect to RCON' }
    }
  }

  async syncProperties(instanceId: string) {
    const instance = await this.getInstanceOrThrow(instanceId)
    await this.ensureRconProperties(instanceId, instance)
  }
}

export const rconService = new RconService()
