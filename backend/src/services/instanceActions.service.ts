import { promises as fs } from 'fs'
import path from 'path'
import { InstanceManager } from '../core/InstanceManager'
import { LogService } from '../core/LogService'
import { InstanceConfig, InstanceStatus } from '../core/types'
import { InstanceActionError } from '../core/InstanceActionError'
import { getInstanceEulaPath, getInstanceJarPath, getInstanceServerDir } from '../config/paths'
import { buildStartSpec } from '../core/StartCommandBuilder'
import { attachProcessLogStreams } from '../process/instanceProcess'
import { processManager } from './processManager.service'
import { logStreamService } from './logStream.service'
import { getRuntimeInfo, setStopInProgress, updateStatus } from './runtimeState.service'
import { resolveJavaForInstance } from './java.service'
import { detectHytaleAssetsZip, detectHytaleServerJar } from './hytaleInstaller.service'
import { emitInstanceEvent } from '../core/InstanceEvents'

const logService = new LogService()
const instanceManager = new InstanceManager()

const logPanel = async (id: string, message: string) => {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [panel] ${message}\n`
  await logService.appendLog(id, line)
  logStreamService.emitLog(id, line)
}

const ensureEulaAccepted = async (id: string, instance: InstanceConfig) => {
  const eulaPath = getInstanceEulaPath(id)
  const autoAccept = instance.autoAcceptEula !== false

  if (autoAccept) {
    await fs.mkdir(getInstanceServerDir(id), { recursive: true })
    await fs.writeFile(eulaPath, 'eula=true\n', 'utf-8')
    return
  }

  try {
    const content = await fs.readFile(eulaPath, 'utf-8')
    if (!content.includes('eula=true')) {
      throw new InstanceActionError(409, {
        error: 'EULA not accepted. Set autoAcceptEula=true or create eula.txt with eula=true.',
      })
    }
  } catch (readError: any) {
    if (readError instanceof InstanceActionError) {
      throw readError
    }
    if (readError.code === 'ENOENT') {
      throw new InstanceActionError(409, {
        error: 'EULA not accepted. Set autoAcceptEula=true or create eula.txt with eula=true.',
      })
    }
    throw readError
  }
}

const ensureStartupTarget = async (id: string, instance: InstanceConfig) => {
  if (instance.serverType === 'hytale') {
    return
  }

  if (instance.startup?.mode === 'script') {
    const scriptPath = instance.startup.script ? getInstanceJarPath(id, instance.startup.script) : null
    if (!scriptPath) {
      throw new InstanceActionError(409, { error: 'Startup script not configured for this instance' })
    }

    try {
      await fs.access(scriptPath)
    } catch (scriptError: any) {
      if (scriptError.code === 'ENOENT') {
        throw new InstanceActionError(409, {
          error: `Startup script not found. Expected ${instance.startup.script} in server directory.`,
          expectedScript: instance.startup.script,
          serverDir: getInstanceServerDir(id),
        })
      }
      throw scriptError
    }
    return
  }

  const jarFileName = instance.serverJar && instance.serverJar.trim() ? instance.serverJar : 'server.jar'
  const jarPath = getInstanceJarPath(id, jarFileName)
  try {
    await fs.access(jarPath)
  } catch (jarError: any) {
    if (jarError.code === 'ENOENT') {
      throw new InstanceActionError(409, {
        error: `Server JAR not found. Put ${jarFileName} into ${getInstanceServerDir(id)}.`,
        expectedJar: jarFileName,
        serverDir: getInstanceServerDir(id),
      })
    }
    throw jarError
  }
}

const ensureHytaleFiles = async (id: string, instance: InstanceConfig) => {
  const serverDir = getInstanceServerDir(id)
  const jarFileName = instance.serverJar?.trim()
  const jarPath = jarFileName ? path.join(serverDir, jarFileName) : null
  const assetsConfigPath = instance.hytale?.assetsPath ?? 'Assets.zip'
  const assetsPath = path.join(serverDir, assetsConfigPath)
  const listTopLevel = async () => {
    try {
      const entries = await fs.readdir(serverDir, { withFileTypes: true })
      return entries.map((entry) => entry.name)
    } catch {
      return []
    }
  }
  const listJarNames = async () => {
    try {
      const entries = await fs.readdir(serverDir, { withFileTypes: true })
      return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar')).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  try {
    if (!jarPath) {
      throw Object.assign(new Error('Hytale server jar not configured'), { code: 'ENOENT' })
    }
    await fs.access(jarPath)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const detectedJar = await detectHytaleServerJar(serverDir)
      const jarCandidates = await listJarNames()
      const topLevelEntries = await listTopLevel()
      throw new InstanceActionError(409, {
        error: jarFileName
          ? `Hytale server jar not found. Expected ${jarFileName} in ${serverDir}.`
          : 'Hytale server jar not configured. Run prepare to download game.zip.',
        expectedJar: jarFileName ?? undefined,
        detectedJar: detectedJar ?? undefined,
        jarCandidates: jarCandidates.length ? jarCandidates : undefined,
        topLevelEntries: topLevelEntries.length ? topLevelEntries : undefined,
        serverDir,
      })
    }
    throw error
  }

  try {
    await fs.access(assetsPath)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const detectedAssets = await detectHytaleAssetsZip(serverDir)
      const topLevelEntries = await listTopLevel()
      throw new InstanceActionError(409, {
        error: `Assets.zip not found. Expected ${assetsConfigPath} in ${serverDir}.`,
        expectedAssets: assetsPath,
        detectedAssets: detectedAssets ?? undefined,
        topLevelEntries: topLevelEntries.length ? topLevelEntries : undefined,
        serverDir,
      })
    }
    throw error
  }
}

const performStart = async (
  id: string,
  instance: InstanceConfig,
  javaResolution: { javaBin: string; javaHome?: string },
) => {
  const startMinecraft = instance.serverType !== 'modded' && instance.serverType !== 'hytale'

  if (startMinecraft) {
    await ensureEulaAccepted(id, instance)
    await ensureStartupTarget(id, instance)
  }

  if (instance.serverType === 'hytale') {
    await ensureHytaleFiles(id, instance)
  }

  updateStatus(id, 'starting', null)

  try {
    const startSpec = buildStartSpec(instance, id, javaResolution)
    const child = processManager.start(id, startSpec.command, startSpec.args, {
      cwd: startSpec.cwd,
      env: startSpec.env ?? { ...process.env },
    })

    attachProcessLogStreams(id, child, logService)

    child.once('error', () => {
      updateStatus(id, 'error', null)
    })

    child.once('exit', (code) => {
      const status: InstanceStatus = code === 0 ? 'stopped' : 'error'
      updateStatus(id, status, null)
    })

    const pid = processManager.getPid(id)
    updateStatus(id, 'running', pid, Date.now())

    return { id, status: 'running' as const, pid }
  } catch (startError: any) {
    updateStatus(id, 'error', null)
    const message =
      startError?.message || 'Failed to start instance. Please install Java 17 or 21 and try again.'
    console.error(`Failed to start instance ${id}`, startError)
    throw new InstanceActionError(500, { error: message })
  }
}

export class InstanceActionService {
  async start(id: string) {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      throw new InstanceActionError(404, { error: 'Instance not found' })
    }

    if (processManager.isRunning(id)) {
      throw new InstanceActionError(409, { error: 'Instance is already running' })
    }

    emitInstanceEvent('starting', id)
    const javaResolution = await resolveJavaForInstance(
      instance,
      instance.minecraftVersion ?? '',
      instance.serverType,
    )
    if (javaResolution.status !== 'resolved') {
      throw new InstanceActionError(409, {
        error: 'NEEDS_JAVA',
        recommendedMajor: javaResolution.requirement.major,
        requirement: javaResolution.requirement,
        candidates: javaResolution.candidates,
        reasons: javaResolution.reasons,
      })
    }

    try {
      const result = await performStart(id, instance, javaResolution)
      emitInstanceEvent('started', id)
      return result
    } catch (error) {
      emitInstanceEvent('start_failed', id)
      throw error
    }
  }

  async sendCommand(id: string, commandRaw: string) {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      throw new InstanceActionError(404, { error: 'Instance not found' })
    }

    const command = typeof commandRaw === 'string' ? commandRaw.trim() : ''
    if (command.length === 0 || command.length > 2000) {
      throw new InstanceActionError(400, { error: 'command must be a non-empty string up to 2000 characters' })
    }

    if (!processManager.isRunning(id)) {
      throw new InstanceActionError(409, { error: 'Instance not running' })
    }

    const sent = processManager.sendCommand(id, command)
    if (!sent) {
      throw new InstanceActionError(409, { error: 'Instance not running' })
    }

    await logPanel(id, `command: ${command}`)

    return { id, ok: true }
  }

  async stop(id: string) {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      throw new InstanceActionError(404, { error: 'Instance not found' })
    }

    if (!processManager.isRunning(id)) {
      updateStatus(id, 'stopped', null)
      emitInstanceEvent('stopped', id)
      setStopInProgress(id, false)
      return { id, status: 'stopped' as const }
    }

    emitInstanceEvent('stopping', id)
    setStopInProgress(id, true)
    await logPanel(id, 'stop requested')
    const graceful = await processManager.stopGracefully(id, 10000)
    if (!graceful || processManager.wasForceKilled(id)) {
      await logPanel(id, 'stop timeout, force killing process')
      if (processManager.isRunning(id)) {
        await processManager.stop(id)
      }
    }
    updateStatus(id, 'stopped', null)
    emitInstanceEvent('stopped', id)
    setStopInProgress(id, false)

    return { id, status: 'stopped' as const }
  }

  async restart(id: string) {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      throw new InstanceActionError(404, { error: 'Instance not found' })
    }

    if (processManager.isRunning(id)) {
      emitInstanceEvent('stopping', id)
      setStopInProgress(id, true)
      await logPanel(id, 'stop requested')
      const graceful = await processManager.stopGracefully(id, 10000)
      if (!graceful || processManager.wasForceKilled(id)) {
        await logPanel(id, 'stop timeout, force killing process')
        if (processManager.isRunning(id)) {
          await processManager.stop(id)
        }
      }
    }

    updateStatus(id, 'stopped', null)
    emitInstanceEvent('stopped', id)
    setStopInProgress(id, false)
    emitInstanceEvent('starting', id)
    const javaResolution = await resolveJavaForInstance(
      instance,
      instance.minecraftVersion ?? '',
      instance.serverType,
    )
    if (javaResolution.status !== 'resolved') {
      throw new InstanceActionError(409, {
        error: 'NEEDS_JAVA',
        recommendedMajor: javaResolution.requirement.major,
        requirement: javaResolution.requirement,
        candidates: javaResolution.candidates,
        reasons: javaResolution.reasons,
      })
    }

    const result = await performStart(id, instance, javaResolution)
    emitInstanceEvent('started', id)
    return result
  }

  async status(id: string) {
    const instance = await instanceManager.getInstance(id)
    if (!instance) {
      throw new InstanceActionError(404, { error: 'Instance not found' })
    }

    const isRunning = processManager.isRunning(id)
    const pid = processManager.getPid(id)
    const runtime = getRuntimeInfo(id)

    if (isRunning) {
      updateStatus(id, runtime.status === 'starting' ? 'starting' : 'running', pid)
    } else if (runtime.status === 'running' || runtime.status === 'starting') {
      updateStatus(id, 'stopped', null)
    }

    const current = getRuntimeInfo(id)
    return {
      id,
      status: current.status,
      pid: current.pid,
      startInProgress: current.startInProgress ?? false,
      lastActivityAt: current.lastActivityAt,
      sleepEnabled: instance.sleep?.sleepEnabled ?? false,
    }
  }
}

export const instanceActionService = new InstanceActionService()
