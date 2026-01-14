import net from 'net'
import { InstanceManager } from '../core/InstanceManager'
import { LogService } from '../core/LogService'
import { instanceEvents } from '../core/InstanceEvents'
import { sleepService } from './sleep.service'
import { getRuntimeInfo } from './runtimeState.service'
import { resolveServerPort, DEFAULT_SERVER_PORT } from './serverProperties.service'

const START_COOLDOWN_MS = 30 * 1000
const REFRESH_INTERVAL_MS = 15000

const readVarInt = (buffer: Buffer, offset = 0): { value: number; size: number } | null => {
  let numRead = 0
  let result = 0
  let read: number
  do {
    if (offset + numRead >= buffer.length) return null
    read = buffer[offset + numRead]
    const value = read & 0b01111111
    result |= value << (7 * numRead)
    numRead += 1
    if (numRead > 5) return null
  } while (read & 0b10000000)

  return { value: result, size: numRead }
}

const encodeVarInt = (value: number) => {
  const bytes: number[] = []
  let val = value
  do {
    let temp = val & 0b01111111
    val >>>= 7
    if (val !== 0) {
      temp |= 0b10000000
    }
    bytes.push(temp)
  } while (val !== 0)
  return Buffer.from(bytes)
}

const buildStatusResponse = (json: string) => {
  const jsonBuffer = Buffer.from(json, 'utf8')
  const length = encodeVarInt(1 + jsonBuffer.length)
  return Buffer.concat([length, Buffer.from([0x00]), jsonBuffer])
}

const buildPongResponse = (payload: Buffer) => {
  const length = encodeVarInt(1 + payload.length)
  return Buffer.concat([length, Buffer.from([0x01]), payload])
}

class PingWakeService {
  private listeners = new Map<string, net.Server>()
  private ports = new Map<string, number>()
  private cooldown = new Map<string, number>()
  private refreshTimer: NodeJS.Timeout | null = null
  private instanceManager = new InstanceManager()
  private logService = new LogService()

  start() {
    if (this.refreshTimer) return
    this.refreshAll().catch((error) => console.error('ping wake refresh failed', error))
    this.refreshTimer = setInterval(
      () => this.refreshAll().catch((error) => console.error('ping wake refresh failed', error)),
      REFRESH_INTERVAL_MS,
    )

    instanceEvents.on('starting', (id: string) => this.releaseListener(id))
    instanceEvents.on('stopping', (id: string) => this.releaseListener(id))
    instanceEvents.on('stopped', (id: string) => this.ensureListener(id).catch(() => undefined))
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    for (const [id, server] of this.listeners.entries()) {
      server.close()
      this.listeners.delete(id)
    }
  }

  private async log(instanceId: string, message: string) {
    const line = `[sleep] ${message}\n`
    await this.logService.appendLog(instanceId, line)
  }

  private async readPort(instanceId: string): Promise<number> {
    try {
      return await resolveServerPort(instanceId)
    } catch {
      return DEFAULT_SERVER_PORT
    }
  }

  private async refreshAll() {
    const instances = await this.instanceManager.listInstances()
    for (const instance of instances) {
      await this.ensureListener(instance.id)
    }
  }

  private async ensureListener(instanceId: string) {
    const instance = await this.instanceManager.getInstance(instanceId)
    if (!instance) return
    if (instance.serverType === 'hytale') {
      await this.releaseListener(instanceId)
      return
    }
    const settings = instance.sleep ?? {}
    if (!settings.wakeOnPing) {
      await this.releaseListener(instanceId)
      return
    }

    const runtime = getRuntimeInfo(instanceId)
    if (runtime.status === 'running' || runtime.startInProgress) {
      await this.releaseListener(instanceId)
      return
    }

    const port = await this.readPort(instanceId)
    const existing = this.listeners.get(instanceId)
    if (existing && this.ports.get(instanceId) === port) return
    if (existing) {
      await this.releaseListener(instanceId)
    }

    const server = net.createServer((socket) => this.handleConnection(instanceId, socket))
    server.on('error', async (err: any) => {
      console.error(`Wake listener error for ${instanceId}`, err)
      await this.log(instanceId, `sleep.wake.error - ping listener error: ${err?.code ?? err?.message ?? err}`)
      this.listeners.delete(instanceId)
    })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen({ port, host: '0.0.0.0' }, () => {
          server.off('error', reject)
          resolve()
        })
      })
      await this.log(instanceId, `sleep.wake.listen - waiting for ping on port ${port}`)
      this.listeners.set(instanceId, server)
      this.ports.set(instanceId, port)
    } catch (error) {
      console.error(`Failed to bind ping listener for ${instanceId} on port ${port}`, error)
      await this.log(instanceId, `sleep.wake.error - port ${port} unavailable for wake listener`)
    }
  }

  private async releaseListener(instanceId: string) {
    const existing = this.listeners.get(instanceId)
    if (!existing) return
    await new Promise<void>((resolve) => existing.close(() => resolve()))
    this.listeners.delete(instanceId)
  }

  private async handleConnection(instanceId: string, socket: net.Socket) {
    const runtime = getRuntimeInfo(instanceId)
    const now = Date.now()
    const cooldownUntil = this.cooldown.get(instanceId) ?? 0
    const startBlocked = now < cooldownUntil
    const startStatus = startBlocked ? 'cooldown' : runtime.startInProgress ? 'starting' : runtime.status

    const sendStatus = (description: string, playersOnline = 0, playersMax = 1) => {
      const payload = {
        version: { name: 'Wake proxy', protocol: 760 },
        players: { max: playersMax, online: playersOnline },
        description: { text: description },
      }
      socket.write(buildStatusResponse(JSON.stringify(payload)))
    }

    let buffer = Buffer.alloc(0)
    let handshakeComplete = false
    let pongPayload: Buffer | null = null

    socket.on('data', async (data: Buffer) => {
      buffer = Buffer.concat([buffer, data])

      while (buffer.length > 0) {
        const packetLength = readVarInt(buffer, 0)
        if (!packetLength) return
        if (buffer.length < packetLength.value + packetLength.size) return

        const packetIdInfo = readVarInt(buffer, packetLength.size)
        if (!packetIdInfo) return
        const packetId = packetIdInfo.value

        const payloadStart = packetLength.size + packetIdInfo.size
        const payload = buffer.subarray(payloadStart, packetLength.size + packetLength.value)

        buffer = buffer.subarray(packetLength.size + packetLength.value)

        if (!handshakeComplete) {
          if (packetId !== 0x00) {
            socket.destroy()
            return
          }
          let offset = 0
          const protocolInfo = readVarInt(payload, offset)
          if (!protocolInfo) return
          offset += protocolInfo.size

          const addrLengthInfo = readVarInt(payload, offset)
          if (!addrLengthInfo) return
          offset += addrLengthInfo.size
          if (payload.length < offset + addrLengthInfo.value + 2) {
            socket.destroy()
            return
          }
          offset += addrLengthInfo.value
          offset += 2 // port

          const stateInfo = readVarInt(payload, offset)
          if (!stateInfo || stateInfo.value !== 1) {
            socket.destroy()
            return
          }
          handshakeComplete = true
          continue
        }

        if (packetId === 0x00) {
          if (startStatus === 'starting') {
            sendStatus('Waking up...')
          } else if (startStatus === 'cooldown') {
            sendStatus('Offline / Start failed, retry shortly')
          } else {
            const wakeResult = await this.triggerWake(instanceId)
            const description = wakeResult === 'failed' ? 'Offline / Start failed' : 'Waking up...'
            sendStatus(description)
          }
        } else if (packetId === 0x01) {
          pongPayload = payload
          if (pongPayload) {
            socket.write(buildPongResponse(pongPayload))
          }
          socket.end()
          return
        }
      }
    })

    socket.on('error', (err) => {
      console.error(`Ping listener socket error for ${instanceId}`, err)
    })
  }

  private async triggerWake(instanceId: string): Promise<'started' | 'starting' | 'failed'> {
    if (this.cooldown.has(instanceId)) {
      const until = this.cooldown.get(instanceId) ?? 0
      if (Date.now() < until) return 'failed'
    }

    try {
      await this.releaseListener(instanceId)
      const result = await sleepService.wake(instanceId)
      if (result.status === 'started' || result.status === 'already_running') {
        return 'started'
      }
      if (result.status === 'starting') {
        return 'starting'
      }
      if (result.status === 'cooldown') {
        return 'failed'
      }
      return 'failed'
    } catch (error) {
      this.cooldown.set(instanceId, Date.now() + START_COOLDOWN_MS)
      await this.log(instanceId, 'sleep.wake.error - start failed after ping')
      return 'failed'
    }
  }
}

export const pingWakeService = new PingWakeService()
