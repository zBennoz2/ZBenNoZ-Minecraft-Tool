import { InstanceRuntimeInfo, InstanceStatus } from '../core/types'
import { logStreamService } from './logStream.service'

const runtimeState = new Map<string, InstanceRuntimeInfo>()

export const getRuntimeInfo = (id: string): InstanceRuntimeInfo => {
  const existing = runtimeState.get(id)
  if (existing) return existing
  const initial: InstanceRuntimeInfo = {
    id,
    status: 'stopped',
    pid: null,
    startedAt: null,
    lastActivityAt: null,
    startInProgress: false,
    stopInProgress: false,
    onlinePlayers: null,
  }
  runtimeState.set(id, initial)
  return initial
}

export const updateStatus = (
  id: string,
  status: InstanceStatus,
  pid: number | null,
  startedAt: number | null = null,
) => {
  const runtime = getRuntimeInfo(id)
  const next: InstanceRuntimeInfo = {
    ...runtime,
    status,
    pid,
    startedAt: status === 'running' ? startedAt ?? runtime.startedAt ?? Date.now() : null,
    startInProgress: status === 'starting' ? true : false,
    stopInProgress: status === 'stopped' ? false : runtime.stopInProgress,
  }
  runtimeState.set(id, next)
  logStreamService.emitStatus(id, status)
  return next
}

export const recordActivity = (id: string) => {
  const runtime = getRuntimeInfo(id)
  const next: InstanceRuntimeInfo = { ...runtime, lastActivityAt: Date.now() }
  runtimeState.set(id, next)
}

export const setStopInProgress = (id: string, inProgress: boolean) => {
  const runtime = getRuntimeInfo(id)
  runtimeState.set(id, { ...runtime, stopInProgress: inProgress })
}

export const updateOnlinePlayers = (id: string, onlinePlayers: number | null | undefined) => {
  const runtime = getRuntimeInfo(id)
  const next: InstanceRuntimeInfo = { ...runtime, onlinePlayers: onlinePlayers ?? null }
  runtimeState.set(id, next)
  if (typeof onlinePlayers === 'number' && onlinePlayers > 0) {
    recordActivity(id)
  }
}

export const clearRuntime = (id: string) => runtimeState.delete(id)
