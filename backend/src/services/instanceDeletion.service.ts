import { promises as fs } from 'fs'
import { InstanceManager } from '../core/InstanceManager'
import { getInstanceBackupsDir } from '../config/paths'
import { instanceActionService } from './instanceActions.service'
import { processManager } from './processManager.service'
import { clearRuntime } from './runtimeState.service'
import { logStreamService } from './logStream.service'

const instanceManager = new InstanceManager()

export const deleteInstanceWithCleanup = async (id: string) => {
  const instance = await instanceManager.getInstance(id)
  if (!instance) {
    return { status: 'not_found' as const }
  }

  if (processManager.isRunning(id)) {
    try {
      await instanceActionService.stop(id)
    } catch (error: any) {
      const message = error?.message ?? 'Failed to stop instance before deletion'
      throw new Error(message)
    }
  }

  await fs.rm(getInstanceBackupsDir(id), { recursive: true, force: true })
  await instanceManager.deleteInstance(id)
  clearRuntime(id)
  logStreamService.clearInstance(id)
  return { status: 'deleted' as const }
}
