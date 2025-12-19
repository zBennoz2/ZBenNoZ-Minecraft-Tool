import { promises as fs, existsSync, createReadStream } from 'fs'
import os from 'os'
import path from 'path'
import tar from 'tar'
import extractZip from 'extract-zip'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { InstanceManager } from '../core/InstanceManager'
import { InstanceConfig } from '../core/types'
import { getInstanceBackupsDir, getInstanceServerDir } from '../config/paths'
import { jobService } from './job.service'
import { instanceActionService } from './instanceActions.service'
import { processManager } from './processManager.service'

export type BackupFormat = 'zip' | 'tar.gz'

export interface BackupInfo {
  id: string
  name: string
  size: number
  createdAt: string
  format: BackupFormat
  path: string
}

const DEFAULT_FORMAT: BackupFormat = 'zip'
const execFileAsync = promisify(execFile)

const safeFormat = (input?: string): BackupFormat => {
  return input === 'zip' || input === 'tar.gz' ? (input as BackupFormat) : DEFAULT_FORMAT
}

const buildBackupName = (format: BackupFormat) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const ext = format === 'zip' ? 'zip' : 'tar.gz'
  return `backup-${timestamp}.${ext}`
}

const ensureDir = async (dir: string) => fs.mkdir(dir, { recursive: true })

interface BackupEntry {
  name: string
  isDir: boolean
}

const collectEntries = async (serverDir: string): Promise<BackupEntry[]> => {
  const entries = await fs.readdir(serverDir, { withFileTypes: true })
  const include: BackupEntry[] = []
  const includeNames = new Set([
    'server.properties',
    'whitelist.json',
    'ops.json',
    'banned-players.json',
    'banned-ips.json',
    'config',
    'mods',
    'plugins',
  ])

  for (const entry of entries) {
    if (includeNames.has(entry.name)) {
      include.push({ name: entry.name, isDir: entry.isDirectory() })
      continue
    }
    if (entry.isDirectory() && entry.name.startsWith('world')) {
      include.push({ name: entry.name, isDir: true })
    }
  }

  return include
}

const createTarball = async (sourceDir: string, targetPath: string, entries: BackupEntry[]) => {
  await tar.create({ gzip: true, cwd: sourceDir, file: targetPath }, entries.map((entry) => entry.name))
}

const createZipArchive = async (sourceDir: string, targetPath: string, entries: BackupEntry[]) => {
  const entryPaths = entries.map((entry) => entry.name)
  try {
    if (process.platform === 'win32') {
      const quoted = entryPaths.map((entry) => `"${path.join(sourceDir, entry)}"`).join(',')
      const destination = `"${targetPath}"`
      await execFileAsync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Force -Path ${quoted} -DestinationPath ${destination}`])
      return
    }

    await execFileAsync('zip', ['-r', targetPath, ...entryPaths], { cwd: sourceDir })
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error('zip utility not found. Install a zip tool or use tar.gz format instead.')
    }
    throw error
  }
}

class BackupService {
  private instanceManager = new InstanceManager()

  async listBackups(instanceId: string): Promise<BackupInfo[]> {
    const dir = getInstanceBackupsDir(instanceId)
    if (!existsSync(dir)) return []
    const files = await fs.readdir(dir)
    const entries: BackupInfo[] = []
    for (const file of files) {
      const full = path.join(dir, file)
      const stat = await fs.stat(full)
      if (!stat.isFile()) continue
      const format: BackupFormat = file.endsWith('.zip') ? 'zip' : 'tar.gz'
      entries.push({
        id: file,
        name: file,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        format,
        path: full,
      })
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  private applyRetention = async (instance: InstanceConfig) => {
    const max = instance.backups?.maxBackups ?? 10
    if (!max || max <= 0) return
    const list = await this.listBackups(instance.id)
    if (list.length <= max) return
    const toDelete = list.slice(max)
    for (const entry of toDelete) {
      await fs.rm(entry.path, { force: true })
    }
  }

  private async performBackup(
    instance: InstanceConfig,
    format: BackupFormat,
    jobId: string,
    progressStart = 5,
    finalizeJob = true,
  ) {
    const jobUpdate = (partial: Parameters<typeof jobService.updateJob>[1]) => jobService.updateJob(jobId, partial)
    jobUpdate({ status: 'running', message: 'Preparing backup', progress: progressStart })
    const serverDir = getInstanceServerDir(instance.id)
    const entries = await collectEntries(serverDir)
    if (entries.length === 0) {
      throw new Error('No world or config files found to backup')
    }

    await ensureDir(getInstanceBackupsDir(instance.id))
    const name = buildBackupName(format)
    const targetPath = path.join(getInstanceBackupsDir(instance.id), name)
    jobUpdate({ message: 'Archiving files', progress: progressStart + 20 })

    if (format === 'zip') {
      await createZipArchive(serverDir, targetPath, entries)
    } else {
      await createTarball(serverDir, targetPath, entries)
    }

    const stats = await fs.stat(targetPath)
    await this.applyRetention(instance)
    if (finalizeJob) {
      jobUpdate({ status: 'completed', progress: 100, message: 'Backup completed', error: undefined })
    } else {
      jobUpdate({ status: 'running', progress: Math.min(90, progressStart + 60), message: 'Snapshot completed' })
    }

    return {
      id: name,
      name,
      size: stats.size,
      createdAt: stats.mtime.toISOString(),
      format,
      path: targetPath,
    } satisfies BackupInfo
  }

  async createBackup(instanceId: string, formatInput?: string) {
    const instance = await this.instanceManager.getInstance(instanceId)
    if (!instance) return { status: 404 as const, message: 'Instance not found' }

    const format = safeFormat(formatInput)
    const job = jobService.createJob()
    setImmediate(async () => {
      try {
        await this.performBackup(instance, format, job.id)
      } catch (error: any) {
        jobService.updateJob(job.id, {
          status: 'failed',
          progress: 100,
          message: 'Backup failed',
          error: error?.message ?? 'Unknown backup error',
        })
      }
    })

    return { status: 202 as const, jobId: job.id }
  }

  async deleteBackup(instanceId: string, backupId: string) {
    const dir = getInstanceBackupsDir(instanceId)
    const filePath = path.join(dir, backupId)
    try {
      await fs.rm(filePath)
      return true
    } catch (error: any) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }

  async streamBackup(instanceId: string, backupId: string) {
    const dir = getInstanceBackupsDir(instanceId)
    const filePath = path.join(dir, backupId)
    try {
      const stats = await fs.stat(filePath)
      if (!stats.isFile()) return null
      return { stream: createReadStream(filePath), size: stats.size, format: backupId.endsWith('.zip') ? 'zip' : 'tar.gz' }
    } catch (error: any) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async restore(
    instanceId: string,
    backupId: string,
    options: { forceStop?: boolean; preRestoreSnapshot?: boolean; autoStart?: boolean },
  ) {
    const instance = await this.instanceManager.getInstance(instanceId)
    if (!instance) return { status: 404 as const, message: 'Instance not found' }

    const backupPath = path.join(getInstanceBackupsDir(instanceId), backupId)
    if (!existsSync(backupPath)) return { status: 404 as const, message: 'Backup not found' }

    if (processManager.isRunning(instanceId)) {
      if (!options.forceStop) {
        return { status: 409 as const, message: 'Instance must be stopped before restore' }
      }
      await instanceActionService.stop(instanceId)
    }

    const job = jobService.createJob()
    setImmediate(async () => {
      jobService.updateJob(job.id, { status: 'running', progress: 5, message: 'Preparing restore' })
      try {
        if (options.preRestoreSnapshot) {
          await this.performBackup(instance, 'tar.gz', job.id, 5, false)
        }

        const serverDir = getInstanceServerDir(instanceId)
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `mc-restore-${instanceId}-`))
        const extractTarget = path.join(tempDir, 'server')
        await fs.mkdir(extractTarget, { recursive: true })
        jobService.updateJob(job.id, { message: 'Extracting backup', progress: 40 })

        if (backupPath.endsWith('.zip')) {
          await extractZip(backupPath, { dir: extractTarget })
        } else {
          await tar.extract({ cwd: extractTarget, file: backupPath })
        }

        const swapDir = `${serverDir}-old-${Date.now()}`
        if (existsSync(serverDir)) {
          await fs.rename(serverDir, swapDir)
        }
        await fs.rename(extractTarget, serverDir)
        jobService.updateJob(job.id, { status: 'completed', progress: 100, message: 'Restore completed' })

        if (options.autoStart) {
          try {
            await instanceActionService.start(instanceId)
          } catch (startError: any) {
            jobService.updateJob(job.id, {
              status: 'failed',
              progress: 100,
              message: 'Restore completed but start failed',
              error: startError?.message ?? 'Start failed after restore',
            })
          }
        }
      } catch (error: any) {
        jobService.updateJob(job.id, {
          status: 'failed',
          progress: 100,
          message: 'Restore failed',
          error: error?.message ?? 'Unknown restore error',
        })
      }
    })

    return { status: 202 as const, jobId: job.id }
  }
}

export const backupService = new BackupService()
