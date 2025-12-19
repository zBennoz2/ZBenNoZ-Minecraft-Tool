import { execFile } from 'child_process'
import { Router } from 'express'
import os from 'os'
import { promisify } from 'util'

interface CpuMetrics {
  usedPercent: number | null
}

interface MemoryMetrics {
  totalBytes: number | null
  usedBytes: number | null
  freeBytes: number | null
  usedPercent: number | null
}

interface DiskMetrics {
  filesystem: string
  mountpoint: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usedPercent: number
}

interface SystemOverviewResponse {
  cpu: CpuMetrics
  memory: MemoryMetrics
  disks: DiskMetrics[]
  uptimeSeconds: number
  loadAverage: number | null
  timestamp: number
}

const router = Router()
const execFileAsync = promisify(execFile)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const readCpuUsagePercent = async (): Promise<number | null> => {
  if (os.platform() === 'win32') return null

  const sample = () =>
    os.cpus().map((cpu) => {
      const { user, nice, sys, idle, irq } = cpu.times
      const busy = user + nice + sys + irq
      const total = busy + idle
      return { busy, idle, total }
    })

  const first = sample()
  await wait(500)
  const second = sample()

  const deltas = second.map((curr, index) => {
    const prev = first[index]
    const busy = curr.busy - prev.busy
    const idle = curr.idle - prev.idle
    const total = curr.total - prev.total
    return { busy, idle, total }
  })

  const aggregate = deltas.reduce(
    (acc, curr) => ({
      busy: acc.busy + curr.busy,
      idle: acc.idle + curr.idle,
      total: acc.total + curr.total,
    }),
    { busy: 0, idle: 0, total: 0 },
  )

  if (aggregate.total <= 0) return null

  return Math.min(100, Math.max(0, (aggregate.busy / aggregate.total) * 100))
}

const readDiskUsage = async (): Promise<DiskMetrics[]> => {
  if (os.platform() === 'win32') return []

  try {
    const { stdout } = await execFileAsync('df', ['-kP'])
    const lines = stdout.trim().split(/\n+/)
    const entries = lines.slice(1)

    return entries
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 6)
      .map((parts) => {
        const [filesystem, blocks, used, available, capacity, mountpoint] = parts
        const totalBytes = Number.parseInt(blocks ?? '0', 10) * 1024
        const usedBytes = Number.parseInt(used ?? '0', 10) * 1024
        const freeBytes = Number.parseInt(available ?? '0', 10) * 1024
        const usedPercent = Number.parseFloat((capacity ?? '0').replace(/%$/, ''))

        return {
          filesystem,
          mountpoint,
          totalBytes,
          usedBytes,
          freeBytes,
          usedPercent,
        }
      })
  } catch (error) {
    console.error('[system] Failed to read disk usage', error)
    return []
  }
}

router.get('/', async (_req, res) => {
  try {
    const [cpuPercent, disks] = await Promise.all([readCpuUsagePercent(), readDiskUsage()])

    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = totalMemory - freeMemory
    const memoryUsedPercent = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : null

    const payload: SystemOverviewResponse = {
      cpu: { usedPercent: cpuPercent },
      memory: {
        totalBytes: Number.isFinite(totalMemory) ? totalMemory : null,
        freeBytes: Number.isFinite(freeMemory) ? freeMemory : null,
        usedBytes: Number.isFinite(usedMemory) ? usedMemory : null,
        usedPercent: Number.isFinite(memoryUsedPercent ?? NaN)
          ? Math.min(100, Math.max(0, memoryUsedPercent ?? 0))
          : null,
      },
      disks,
      uptimeSeconds: Math.max(0, Math.floor(os.uptime())),
      loadAverage: os.platform() === 'win32' ? null : os.loadavg()[0] ?? null,
      timestamp: Date.now(),
    }

    return res.json(payload)
  } catch (error) {
    console.error('[system] Failed to build system overview', error)
    return res.status(500).json({ error: 'Failed to read system metrics' })
  }
})

export default router
