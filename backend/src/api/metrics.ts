import { execFile } from 'child_process'
import { Request, Response, Router } from 'express'
import { promisify } from 'util'
import { InstanceManager } from '../core/InstanceManager'
import { InstanceStatus } from '../core/types'
import { processManager } from '../services/processManager.service'
import { getRuntimeInfo, updateOnlinePlayers, updateStatus } from '../services/runtimeState.service'
import {
  DEFAULT_SERVER_PORT,
  extractMaxPlayers,
  extractServerPort,
  readServerProperties,
} from '../services/serverProperties.service'
import { queryMinecraftStatus } from '../services/mcStatus.service'

interface InstanceMetricsResponse {
  status: InstanceStatus
  pid: number | null
  cpuPercent: number | null
  memoryBytes: number | null
  memoryLimitBytes: number | null
  uptimeMs: number | null
  playersOnline: number | null
  playersMax: number | null
  onlinePlayers?: number | null
  maxPlayers?: number | null
  latencyMs?: number | null
  playersSource?: 'query' | 'rcon' | 'logs' | 'fallback' | 'unavailable'
  tps?: number | null
  metricsAvailable: boolean
  message?: string
}

const router = Router()
const instanceManager = new InstanceManager()
const execFileAsync = promisify(execFile)

const metricsCache = new Map<string, { timestamp: number; data: InstanceMetricsResponse }>()
const CACHE_WINDOW_MS = 1500
const PLAYER_CACHE_WINDOW_MS = 5000
const PLAYER_PING_TIMEOUT_MS = 4000

type PlayerMetrics = {
  playersOnline: number | null
  playersMax: number | null
  latencyMs: number | null
  playersSource: InstanceMetricsResponse['playersSource']
}

const playerMetricsCache = new Map<string, { timestamp: number; data: PlayerMetrics }>()

const parseMemoryLimit = (value?: string | number | null): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = /^([0-9]+(?:\.[0-9]+)?)([kKmMgG])?$/.exec(trimmed)
  if (!match) return null
  const amount = Number.parseFloat(match[1])
  const unit = match[2]?.toLowerCase()
  const multipliers: Record<string, number> = {
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
  }
  const factor = unit ? multipliers[unit] ?? 1 : 1
  return Math.round(amount * factor)
}

const readProcessUsage = async (
  pid: number,
): Promise<{ cpuPercent: number | null; memoryBytes: number | null }> => {
  if (process.platform === 'win32') {
    return { cpuPercent: null, memoryBytes: null }
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu,rss'])
    const lines = stdout.trim().split(/\n+/)
    const dataLine = lines[lines.length - 1]?.trim()
    if (!dataLine) return { cpuPercent: null, memoryBytes: null }

    const parts = dataLine.split(/\s+/)
    const cpuRaw = Number.parseFloat(parts[0] ?? '')
    const rssKb = Number.parseFloat(parts[1] ?? '')

    return {
      cpuPercent: Number.isFinite(cpuRaw) ? cpuRaw : null,
      memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
    }
  } catch (error) {
    console.error(`Failed to execute ps for pid ${pid}`, error)
    return { cpuPercent: null, memoryBytes: null }
  }
}

const buildFallback = (
  status: InstanceStatus,
  pid: number | null,
  message?: string,
): InstanceMetricsResponse => ({
  status,
  pid,
  cpuPercent: status === 'running' ? null : 0,
  memoryBytes: status === 'running' ? null : 0,
  memoryLimitBytes: null,
  uptimeMs: null,
  playersOnline: null,
  playersMax: null,
  onlinePlayers: null,
  maxPlayers: null,
  latencyMs: null,
  playersSource: 'unavailable',
  metricsAvailable: status !== 'running',
  message,
})

const resolvePlayerMetrics = async (
  id: string,
  isRunning: boolean,
): Promise<{
  playersOnline: number | null
  playersMax: number | null
  latencyMs: number | null
  playersSource: InstanceMetricsResponse['playersSource']
}> => {
  const cached = playerMetricsCache.get(id)
  if (cached && Date.now() - cached.timestamp < PLAYER_CACHE_WINDOW_MS) {
    return cached.data
  }

  const properties = await readServerProperties(id)
  const maxPlayers = extractMaxPlayers(properties)
  const port = extractServerPort(properties) ?? DEFAULT_SERVER_PORT

  if (!isRunning) {
    const metrics = {
      playersOnline: 0,
      playersMax: maxPlayers,
      latencyMs: null,
      playersSource: 'fallback' as const,
    }
    playerMetricsCache.set(id, { timestamp: Date.now(), data: metrics })
    return metrics
  }

  try {
    const result = await queryMinecraftStatus('127.0.0.1', port, PLAYER_PING_TIMEOUT_MS)

    const playersOnline = Number.isFinite(result?.online) ? result.online : 0
    const playersMax =
      Number.isFinite(result?.max) && typeof result?.max === 'number' ? result.max : maxPlayers
    const metrics = {
      playersOnline,
      playersMax,
      latencyMs: typeof result?.latencyMs === 'number' ? result.latencyMs : null,
      playersSource: 'query' as const,
    }
    playerMetricsCache.set(id, { timestamp: Date.now(), data: metrics })
    return metrics
  } catch (error) {
    console.error(`Failed to query players for ${id}:${port}`, error)
    const metrics = {
      playersOnline: null,
      playersMax: maxPlayers,
      latencyMs: null,
      playersSource: 'unavailable' as const,
    }
    playerMetricsCache.set(id, { timestamp: Date.now(), data: metrics })
    return metrics
  }
}

router.get('/:id/metrics', async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' })
    }

    const runtime = getRuntimeInfo(id)
    const isRunning = processManager.isRunning(id)
    const pid = processManager.getPid(id)
    let status: InstanceStatus = runtime.status

    if (isRunning) {
      status = runtime.status === 'starting' ? 'starting' : 'running'
      updateStatus(id, status, pid, runtime.startedAt ?? Date.now())
    } else if (runtime.status === 'running' || runtime.status === 'starting') {
      status = 'stopped'
      updateStatus(id, 'stopped', null)
    }

    const cached = metricsCache.get(id)
    if (cached && Date.now() - cached.timestamp < CACHE_WINDOW_MS) {
      return res.json(cached.data)
    }

    const playerMetrics = await resolvePlayerMetrics(id, isRunning)
    updateOnlinePlayers(id, playerMetrics.playersOnline ?? (isRunning ? null : 0))

    if (!pid || !isRunning) {
      const fallback = buildFallback(status, pid)
      fallback.playersOnline = playerMetrics.playersOnline
      fallback.playersMax = playerMetrics.playersMax
      fallback.playersSource = playerMetrics.playersSource
      fallback.onlinePlayers = playerMetrics.playersOnline
      fallback.maxPlayers = playerMetrics.playersMax
      fallback.latencyMs = playerMetrics.latencyMs
      metricsCache.set(id, { timestamp: Date.now(), data: fallback })
      return res.json(fallback)
    }

    try {
      const usage = await readProcessUsage(pid)
      const memoryLimitBytes = parseMemoryLimit(instance.memory?.max ?? null)
      const uptimeMs = runtime.startedAt ? Date.now() - runtime.startedAt : null

      const payload: InstanceMetricsResponse = {
        status,
        pid,
        cpuPercent: usage.cpuPercent,
        memoryBytes: usage.memoryBytes,
        memoryLimitBytes,
        uptimeMs,
        playersOnline: playerMetrics.playersOnline,
        playersMax: playerMetrics.playersMax,
        onlinePlayers: playerMetrics.playersOnline,
        maxPlayers: playerMetrics.playersMax,
        latencyMs: playerMetrics.latencyMs,
        playersSource: playerMetrics.playersSource,
        tps: null,
        metricsAvailable: usage.cpuPercent !== null || usage.memoryBytes !== null,
      }

      metricsCache.set(id, { timestamp: Date.now(), data: payload })
      return res.json(payload)
    } catch (metricError) {
      console.error(`Failed to read metrics for instance ${id}`, metricError)
      const fallback = buildFallback(status, pid, 'Process metrics unavailable')
      fallback.playersOnline = playerMetrics.playersOnline
      fallback.playersMax = playerMetrics.playersMax
      fallback.playersSource = playerMetrics.playersSource
      fallback.onlinePlayers = playerMetrics.playersOnline
      fallback.maxPlayers = playerMetrics.playersMax
      fallback.latencyMs = playerMetrics.latencyMs
      metricsCache.set(id, { timestamp: Date.now(), data: fallback })
      return res.json(fallback)
    }
  } catch (error) {
    console.error(`Error fetching metrics for ${id}`, error)
    return res.status(500).json({ error: 'Failed to fetch metrics' })
  }
})

export default router
