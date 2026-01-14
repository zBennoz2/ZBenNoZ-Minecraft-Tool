import { API_KEY, apiUrl } from './config'

export type ServerType = 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' | 'hytale'
export type LoaderType = 'fabric' | 'forge' | 'neoforge'

export type HytaleAuthMode = 'authenticated' | 'offline'
export type HytaleInstallMode = 'downloader' | 'import'

export interface HytaleInstallConfig {
  mode?: HytaleInstallMode
  downloaderUrl?: string
  patchline?: string
  skipUpdateCheck?: boolean
  importServerPath?: string
  importAssetsPath?: string
}

export interface HytaleConfig {
  assetsPath?: string
  bind?: string
  port?: number
  authMode?: HytaleAuthMode
  jvmArgs?: string[]
  install?: HytaleInstallConfig
}

export interface InstanceLoaderInfo {
  type?: LoaderType
  version?: string
}

export interface InstanceMemoryConfig {
  min?: string
  max?: string
}

export interface InstanceJavaConfig {
  preferredMajor?: number
  javaPath?: string | null
}

export interface InstanceStartupConfig {
  mode: 'jar' | 'script'
  script?: string
  args?: string[]
}

export interface Instance {
  id: string
  name: string
  serverType: ServerType
  status?: string
  minecraftVersion?: string
  loader?: InstanceLoaderInfo
  memory?: InstanceMemoryConfig
  java?: InstanceJavaConfig
  javaPath?: string | null
  nogui?: boolean
  autoAcceptEula?: boolean
  startup?: InstanceStartupConfig
  sleep?: SleepSettings
  backups?: BackupSettings
  serverPort?: number | null
  hytale?: HytaleConfig
}

export interface SleepSettings {
  sleepEnabled?: boolean
  idleMinutes?: number
  wakeOnPing?: boolean
  wakeGraceSeconds?: number
  stopMethod?: 'graceful'
}

export interface SleepStatus {
  enabled: boolean
  idleFor: number | null
  lastActivityAt: number | null
  stopInProgress: boolean
  startInProgress: boolean
  proxyStatus: 'idle' | 'disabled'
  onlinePlayers: number | null
}

export interface BackupSettings {
  maxBackups?: number
}

export interface InstanceStatus {
  status: 'running' | 'stopped' | 'unknown' | 'starting' | 'error'
  pid?: number | null
}

export interface InstanceMetrics {
  status: InstanceStatus['status']
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

export interface WhitelistEntry {
  uuid?: string | null
  name: string
}

export type TaskType = 'backup' | 'restart' | 'stop' | 'start' | 'command' | 'sleep'

export type TaskSchedule =
  | { mode: 'cron'; expression: string }
  | { mode: 'interval'; intervalMinutes: number }

export interface ScheduledTaskPayload {
  command?: string
}

export interface ScheduledTask {
  id: string
  instanceId: string
  enabled: boolean
  type: TaskType
  schedule: TaskSchedule
  payload?: ScheduledTaskPayload
  lastRunAt?: string | null
  nextRunAt?: string | null
  running?: boolean
}

export interface JavaCandidate {
  source: 'system' | 'managed'
  path: string
  major: number
  vendor?: string
  versionRaw?: string
}

export interface JavaRequirement {
  major: number
  mode: 'minimum' | 'exact'
}

export interface SystemOverview {
  cpu: { usedPercent: number | null }
  memory: {
    totalBytes: number | null
    usedBytes: number | null
    freeBytes: number | null
    usedPercent: number | null
  }
  disks: {
    filesystem: string
    mountpoint: string
    totalBytes: number
    usedBytes: number
    freeBytes: number
    usedPercent: number
  }[]
  uptimeSeconds: number
  loadAverage: number | null
  timestamp: number
}

export interface CreateInstancePayload {
  name: string
  serverType: ServerType
  minecraftVersion?: string
  loader?: InstanceLoaderInfo
  hytale?: HytaleConfig
}

export interface PrepareInstanceOptions {
  serverType: ServerType
  minecraftVersion?: string
  loader?: InstanceLoaderInfo
  hytaleInstallMode?: HytaleInstallMode
  hytaleDownloaderUrl?: string
  hytaleImportServerPath?: string
  hytaleImportAssetsPath?: string
}

export interface PrepareInstanceResult {
  success: boolean
  message?: string
  status?: 'needs_java'
  recommendedMajor?: number
  requirement?: JavaRequirement
  candidates?: JavaCandidate[]
  reasons?: string[]
  errorCode?: string
}

export type InstanceUpdatePayload = Partial<
  Pick<
    Instance,
    | 'name'
    | 'minecraftVersion'
    | 'memory'
    | 'java'
    | 'javaPath'
    | 'nogui'
    | 'autoAcceptEula'
    | 'startup'
    | 'hytale'
  >
>

export interface HytaleAuthStatus {
  state: 'idle' | 'needs_auth' | 'waiting_for_auth' | 'authenticated' | 'downloading' | 'extracting' | 'configured'
  authenticated: boolean
  deviceUrl?: string
  userCode?: string
  matchedLine?: string
  codeIssuedAt?: string
  expiresAt?: string
  message?: string
  progress?: number
  updatedAt?: string
}

interface CatalogVersionsResponse {
  versions: string[]
  loaderVersionsByMinecraft?: Record<string, string[]>
  loaderVersions?: string[]
}

const sortVersionsDesc = (versions: string[]) =>
  versions
    .slice()
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))

export async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = apiUrl(path)
  // eslint-disable-next-line no-console
  console.log('[api] Requesting', url)

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
      ...options.headers,
    },
    ...options,
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    payload = undefined
  }

  if (!response.ok) {
    const hasErrorField =
      typeof payload === 'object' && payload !== null && 'error' in payload
    const hasMessageField =
      typeof payload === 'object' && payload !== null && 'message' in payload

    const errorMessage = hasErrorField
      ? String((payload as { error?: unknown }).error ?? 'Unknown error')
      : hasMessageField
        ? String((payload as { message?: unknown }).message ?? 'Unknown error')
        : `Request failed with status ${response.status}`

    throw new Error(errorMessage)
  }

  return payload as T
}

export async function getInstances(): Promise<Instance[]> {
  return fetchApi<Instance[]>('/api/instances')
}

export async function listInstances(): Promise<Instance[]> {
  return getInstances()
}

/**
 * Instance settings endpoints:
 *  - GET /api/instances/:id    -> returns Instance (including memory/java/startup/eula fields)
 *  - PUT /api/instances/:id    -> accepts Partial<Instance> to update settings
 */
export async function getInstance(id: string): Promise<Instance> {
  return fetchApi<Instance>(`/api/instances/${id}`)
}

export async function updateInstance(
  id: string,
  payload: InstanceUpdatePayload,
): Promise<Instance> {
  return fetchApi<Instance>(`/api/instances/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
}

export async function getInstanceStatus(id: string): Promise<InstanceStatus> {
  try {
    return await fetchApi<InstanceStatus>(`/api/instances/${id}/status`)
  } catch (error) {
    console.error('Failed to fetch instance status', error)
    return { status: 'unknown', pid: null }
  }
}

export async function getInstanceMetrics(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<InstanceMetrics> {
  const { signal } = options ?? {}
  try {
    return await fetchApi<InstanceMetrics>(`/api/instances/${id}/metrics`, { signal })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw error
    }
    console.error('Failed to fetch instance metrics', error)
    return {
      status: 'unknown',
      pid: null,
      cpuPercent: null,
      memoryBytes: null,
      memoryLimitBytes: null,
      uptimeMs: null,
      playersOnline: null,
      playersMax: null,
      metricsAvailable: false,
      message: error instanceof Error ? error.message : 'Metrics unavailable',
    }
  }
}

export type StartInstanceResult =
  | { status: 'ok' }
  | {
      status: 'needs_java'
      recommendedMajor?: number
      requirement?: JavaRequirement
      candidates?: JavaCandidate[]
      reasons?: string[]
    }

export async function startInstance(id: string): Promise<StartInstanceResult> {
  const url = apiUrl(`/api/instances/${id}/start`)
  // eslint-disable-next-line no-console
  console.log('[api] Requesting', url)
  const response = await fetch(url, { method: 'POST' })

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    payload = undefined
  }

  if (!response.ok) {
    const body = (payload ?? {}) as {
      error?: string
      recommendedMajor?: number
      requirement?: JavaRequirement
      candidates?: JavaCandidate[]
      reasons?: string[]
    }
    if ((response.status === 409 || response.status === 422) && body.error === 'NEEDS_JAVA') {
      return {
        status: 'needs_java',
        recommendedMajor: body.recommendedMajor,
        requirement: body.requirement,
        candidates: body.candidates,
        reasons: body.reasons,
      }
    }

    const hasErrorField =
      typeof payload === 'object' && payload !== null && 'error' in payload
    const hasMessageField =
      typeof payload === 'object' && payload !== null && 'message' in payload

    const errorMessage = hasErrorField
      ? String((payload as { error?: unknown }).error ?? 'Unknown error')
      : hasMessageField
        ? String((payload as { message?: unknown }).message ?? 'Unknown error')
        : `Request failed with status ${response.status}`

    throw new Error(errorMessage)
  }

  return { status: 'ok' }
}

export async function stopInstance(id: string): Promise<void> {
  await fetchApi<void>(`/api/instances/${id}/stop`, { method: 'POST' })
}

export async function restartInstance(id: string): Promise<void> {
  await fetchApi<void>(`/api/instances/${id}/restart`, { method: 'POST' })
}

export async function sendCommand(id: string, command: string): Promise<void> {
  await fetchApi<{ id: string; ok: boolean }>(`/api/instances/${id}/command`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  })
}

export async function createInstance(payload: CreateInstancePayload): Promise<Instance> {
  return fetchApi<Instance>('/api/instances', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function prepareInstance(
  id: string,
  options: PrepareInstanceOptions,
): Promise<PrepareInstanceResult> {
  const response = await fetch(apiUrl(`/api/instances/${id}/prepare`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
    },
    body: JSON.stringify(options),
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    payload = undefined
  }

  if (response.ok) {
    const body = (payload ?? {}) as { message?: string }
    return { success: true, message: body.message ?? 'Prepared successfully' }
  }

  const body = (payload ?? {}) as {
    error?: string
    message?: string
    recommendedMajor?: number
    requirement?: JavaRequirement
    candidates?: JavaCandidate[]
    reasons?: string[]
  }

  if ((response.status === 409 || response.status === 422) && body.error === 'NEEDS_JAVA') {
    return {
      success: false,
      status: 'needs_java',
      message: body.message ?? 'Java runtime required',
      recommendedMajor: body.recommendedMajor,
      requirement: body.requirement,
      candidates: body.candidates,
      reasons: body.reasons,
    }
  }

  const errorMessage =
    typeof body.message === 'string'
      ? body.message
      : typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}`
  return {
    success: false,
    message: errorMessage,
    errorCode: typeof body.error === 'string' ? body.error : undefined,
  }
}

export async function deleteInstance(id: string): Promise<void> {
  await fetchApi<void>(`/api/instances/${id}`, { method: 'DELETE' })
}

export async function getJavaRecommendation(
  mcVersion: string,
  serverType?: ServerType,
): Promise<{ recommendedMajor: number }> {
  const query = new URLSearchParams()
  if (mcVersion) query.set('mcVersion', mcVersion)
  if (serverType) query.set('serverType', serverType)
  return fetchApi<{ recommendedMajor: number }>(`/api/java/recommendation?${query.toString()}`)
}

export async function detectJava(): Promise<JavaCandidate[]> {
  const result = await fetchApi<{ candidates: JavaCandidate[] }>('/api/java/detect')
  return result.candidates
}

export interface JavaInstallStartResult {
  status: 'started' | 'already_installed'
  jobId?: string
  javaPath?: string
}

export async function installJava(major: number): Promise<JavaInstallStartResult> {
  return fetchApi<JavaInstallStartResult>('/api/java/install', {
    method: 'POST',
    body: JSON.stringify({ major }),
  })
}

export function streamJavaInstall(
  jobId: string,
  onEvent: (event: MessageEvent<string>) => void,
): EventSource {
  const url = apiUrl(`/api/java/install/stream?jobId=${jobId}`)
  // eslint-disable-next-line no-console
  console.log('[api] Requesting', url)
  const source = new EventSource(url)
  source.addEventListener('java_install', onEvent)
  return source
}

export async function getHytaleAuthStatus(id: string): Promise<HytaleAuthStatus> {
  return fetchApi<HytaleAuthStatus>(`/api/instances/${id}/hytale/auth`)
}

export async function checkHytaleVersion(id: string): Promise<{ version: string }> {
  return fetchApi<{ version: string }>(`/api/instances/${id}/hytale/update/check`, {
    method: 'POST',
  })
}

export async function updateHytaleServer(id: string): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/api/instances/${id}/hytale/update`, {
    method: 'POST',
  })
}

export async function getCatalogVersions(serverType: ServerType): Promise<CatalogVersionsResponse> {
  switch (serverType) {
    case 'vanilla': {
      const result = await fetchApi<{ versions?: { id: string }[] }>(
        '/api/catalog/vanilla/versions',
      )
      const versions = (result.versions ?? []).map((entry) => entry.id)
      return { versions: sortVersionsDesc(versions) }
    }
    case 'paper': {
      const result = await fetchApi<{ versions?: string[] }>('/api/catalog/paper/versions')
      return { versions: sortVersionsDesc(result.versions ?? []) }
    }
    case 'fabric': {
      const result = await fetchApi<{
        gameVersions?: { version: string }[]
        loaderVersionsByGame?: Record<string, string[]>
      }>('/api/catalog/fabric/versions')

      const versions = (result.gameVersions ?? []).map((entry) => entry.version)
      return {
        versions: sortVersionsDesc(versions),
        loaderVersionsByMinecraft: result.loaderVersionsByGame,
      }
    }
    case 'forge': {
      const result = await fetchApi<{ byMinecraft?: Record<string, { all?: string[] }> }>(
        '/api/catalog/forge/versions',
      )
      const versions = Object.keys(result.byMinecraft ?? {})
      return { versions: sortVersionsDesc(versions) }
    }
    case 'neoforge': {
      const result = await fetchApi<{ versions?: string[] }>('/api/catalog/neoforge/versions')
      return { versions: sortVersionsDesc(result.versions ?? []) }
    }
    default:
      return { versions: [] }
  }
}

export async function getWhitelist(id: string): Promise<WhitelistEntry[]> {
  const response = await fetchApi<{ id: string; entries: WhitelistEntry[] }>(
    `/api/instances/${id}/whitelist`,
  )
  return response.entries ?? []
}

export async function addWhitelistEntry(id: string, name: string): Promise<WhitelistEntry[]> {
  const response = await fetchApi<{ id: string; entries: WhitelistEntry[] }>(
    `/api/instances/${id}/whitelist`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  )
  return response.entries ?? []
}

export async function removeWhitelistEntry(id: string, name: string): Promise<WhitelistEntry[]> {
  const response = await fetchApi<{ id: string; entries: WhitelistEntry[] }>(
    `/api/instances/${id}/whitelist/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
    },
  )
  return response.entries ?? []
}

export interface CreateTaskPayload {
  type: TaskType
  schedule: TaskSchedule
  payload?: ScheduledTaskPayload
  enabled?: boolean
}

export interface UpdateTaskPayload {
  type?: TaskType
  schedule?: TaskSchedule
  payload?: ScheduledTaskPayload
  enabled?: boolean
}

export async function getInstanceTasks(id: string): Promise<ScheduledTask[]> {
  const response = await fetchApi<{ id: string; tasks: ScheduledTask[] }>(`/api/instances/${id}/tasks`)
  return response.tasks ?? []
}

export async function createInstanceTask(id: string, payload: CreateTaskPayload): Promise<ScheduledTask> {
  const response = await fetchApi<{ task: ScheduledTask }>(`/api/instances/${id}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return response.task
}

export async function updateTask(taskId: string, payload: UpdateTaskPayload): Promise<ScheduledTask> {
  const response = await fetchApi<{ task: ScheduledTask }>(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return response.task
}

export async function deleteTask(taskId: string): Promise<void> {
  await fetchApi<void>(`/api/tasks/${taskId}`, { method: 'DELETE' })
}

export type BackupFormat = 'zip' | 'tar.gz'

export interface BackupInfo {
  id: string
  name: string
  size: number
  createdAt: string
  format: BackupFormat
}

export interface BackupJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  message?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export async function getSleepSettings(id: string): Promise<SleepSettings> {
  return fetchApi<SleepSettings>(`/api/instances/${id}/sleep-settings`)
}

export async function updateSleepSettings(id: string, payload: Partial<SleepSettings>): Promise<SleepSettings> {
  return fetchApi<SleepSettings>(`/api/instances/${id}/sleep-settings`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function getSleepStatus(id: string): Promise<SleepStatus> {
  return fetchApi<SleepStatus>(`/api/instances/${id}/sleep-status`)
}

export async function listBackups(id: string): Promise<BackupInfo[]> {
  return fetchApi<BackupInfo[]>(`/api/instances/${id}/backups`)
}

export async function createBackup(id: string, format: BackupFormat): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(`/api/instances/${id}/backups`, {
    method: 'POST',
    body: JSON.stringify({ format }),
  })
}

export async function deleteBackup(id: string, backupId: string): Promise<void> {
  await fetchApi<void>(`/api/instances/${id}/backups/${backupId}`, { method: 'DELETE' })
}

export async function downloadBackup(id: string, backupId: string): Promise<Blob> {
  const url = apiUrl(`/api/instances/${id}/backups/${backupId}/download`)
  // eslint-disable-next-line no-console
  console.log('[api] Requesting', url)

  const response = await fetch(url, {
    headers: {
      ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
    },
  })
  if (!response.ok) {
    throw new Error('Failed to download backup')
  }
  return await response.blob()
}

export async function restoreBackup(
  id: string,
  backupId: string,
  options: { forceStop?: boolean; preRestoreSnapshot?: boolean; autoStart?: boolean },
): Promise<{ jobId: string }> {
  return fetchApi<{ jobId: string }>(`/api/instances/${id}/backups/${backupId}/restore`, {
    method: 'POST',
    body: JSON.stringify(options),
  })
}

export async function getBackupJob(id: string, jobId: string): Promise<BackupJob> {
  return fetchApi<BackupJob>(`/api/instances/${id}/backups/jobs/${jobId}`)
}

export async function getSystemOverview(): Promise<SystemOverview> {
  return fetchApi<SystemOverview>('/api/system')
}
