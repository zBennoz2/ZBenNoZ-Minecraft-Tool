import { createWriteStream, promises as fs, existsSync } from 'fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'
import crypto from 'node:crypto'
import extract from 'extract-zip'
import tar from 'tar'
import { getDataDir, getDownloadCacheDir } from '../config/paths'
import { InstanceConfig, JavaConfig } from '../core/types'

export type JavaSource = 'system' | 'managed'

export interface JavaCandidate {
  source: JavaSource
  path: string
  major: number
  vendor?: string
  versionRaw?: string
}

export interface JavaInstallEvent {
  jobId: string
  phase: 'download' | 'extract' | 'verify' | 'done' | 'error'
  progress: number
  message?: string
  javaPath?: string
}

const JAVA_FILENAME = process.platform === 'win32' ? 'java.exe' : 'java'
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export const getRecommendedJavaMajor = (mcVersion: string, serverType?: string): number => {
  if (serverType === 'hytale') return 25
  const normalized = mcVersion?.trim() ?? ''

  if (/^1\.21(\.|$)/.test(normalized)) return 21
  if (/^1\.20\.(5|6|7|8|9)/.test(normalized)) return 21
  if (/^1\.20\.([0-4]|[0-4]\d)(\.|$)/.test(normalized)) return 17
  if (/^1\.18(\.|$)/.test(normalized)) return 17
  return 17
}

const parseJavaVersion = async (javaPath: string) => {
  return new Promise<JavaCandidate | null>((resolve) => {
    const child = spawn(javaPath, ['-version'])
    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const match = output.match(/version\s+"(\d+)(?:\.\d+)?(?:\.\d+)?(_\d+)?/)
      const vendorMatch = output.match(/(Eclipse Adoptium|OpenJDK|Temurin)/i)
      if (!match) return resolve(null)
      const major = Number.parseInt(match[1] ?? '0', 10)
      if (!Number.isFinite(major) || major <= 0) return resolve(null)
      resolve({ path: javaPath, major, vendor: vendorMatch?.[1], versionRaw: output.trim(), source: 'system' })
    })
  })
}

const collectCandidatesFromPaths = async (pathsToTest: string[], source: JavaSource) => {
  const seen = new Map<string, JavaCandidate>()
  for (const candidatePath of pathsToTest) {
    if (!candidatePath) continue
    const resolvedPath = candidatePath.replace('~', os.homedir())
    if (!existsSync(resolvedPath)) continue
    const parsed = await parseJavaVersion(resolvedPath)
    if (parsed) {
      seen.set(resolvedPath, { ...parsed, path: resolvedPath, source })
    }
  }
  return Array.from(seen.values())
}

const scanSystemPaths = async () => {
  const candidates: JavaCandidate[] = []
  const pathCandidates = new Set<string>()
  pathCandidates.add(JAVA_FILENAME)

  if (process.platform === 'win32') {
    const roots = [
      'C:/Program Files/Java',
      'C:/Program Files/Eclipse Adoptium',
      'C:/Program Files/Adoptium',
    ]
    for (const root of roots) {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          pathCandidates.add(path.join(root, entry.name, 'bin', JAVA_FILENAME))
        }
      } catch {
        // ignore missing directories
      }
    }
  } else {
    pathCandidates.add('/usr/bin/java')
    try {
      const jvmRoot = '/usr/lib/jvm'
      const entries = await fs.readdir(jvmRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        pathCandidates.add(path.join(jvmRoot, entry.name, 'bin', JAVA_FILENAME))
      }
    } catch {
      // ignore
    }
  }

  const parsed = await collectCandidatesFromPaths(Array.from(pathCandidates), 'system')
  candidates.push(...parsed)
  return candidates
}

const getManagedBaseDir = () => path.join(getDataDir(), 'jre')

const getManagedInstallDir = (major: number) => {
  const platform = process.platform
  const arch = process.arch
  return path.join(getManagedBaseDir(), String(major), `${platform}-${arch}`)
}

const findManagedJavaBinaries = async () => {
  const candidates: JavaCandidate[] = []
  try {
    const majors = await fs.readdir(getManagedBaseDir(), { withFileTypes: true })
    for (const majorEntry of majors) {
      if (!majorEntry.isDirectory()) continue
      const major = Number.parseInt(majorEntry.name, 10)
      if (!Number.isFinite(major)) continue
      const majorDir = path.join(getManagedBaseDir(), majorEntry.name)
      const platforms = await fs.readdir(majorDir, { withFileTypes: true })
      for (const platEntry of platforms) {
        if (!platEntry.isDirectory()) continue
        const javaPath = path.join(majorDir, platEntry.name, 'bin', JAVA_FILENAME)
        const parsed = await parseJavaVersion(javaPath)
        if (parsed) {
          candidates.push({ ...parsed, path: javaPath, source: 'managed' })
        }
      }
    }
  } catch {
    // ignore missing base dir
  }
  return candidates
}

export const detectJavaCandidates = async (): Promise<JavaCandidate[]> => {
  const [system, managed] = await Promise.all([scanSystemPaths(), findManagedJavaBinaries()])
  const combined = [...system, ...managed]
  const unique = new Map<string, JavaCandidate>()
  for (const candidate of combined) {
    if (!unique.has(candidate.path)) {
      unique.set(candidate.path, candidate)
    }
  }
  return Array.from(unique.values())
}

const buildDownloadUrl = (major: number) => {
  const osMap: Record<string, string> = {
    win32: 'windows',
    linux: 'linux',
    darwin: 'mac',
    aix: 'linux',
    android: 'linux',
    freebsd: 'linux',
    openbsd: 'linux',
    sunos: 'linux',
  }
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'aarch64',
    arm: 'aarch64',
    ia32: 'x86',
    ppc64: 'ppc64le',
    s390x: 's390x',
    riscv64: 'riscv64',
  }
  const osSlug = osMap[process.platform] ?? 'linux'
  const archSlug = archMap[process.arch] ?? 'x64'
  const extension = process.platform === 'win32' ? 'zip' : 'tar.gz'
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osSlug}/${archSlug}/jre/hotspot/normal/eclipse?project=jre&bundletype=${extension}`
  return { url, extension }
}

const ensureDir = async (dir: string) => fs.mkdir(dir, { recursive: true })

const downloadToFile = async (url: string, destination: string, onProgress: (progress: number) => void) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    let downloaded = 0
    const writable = createWriteStream(destination)
    const reader = response.body.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      downloaded += value?.length ?? 0
      writable.write(value)
      if (total > 0) {
        onProgress(Math.round((downloaded / total) * 100))
      }
    }
    writable.end()
  } finally {
    clearTimeout(timeout)
  }
}

const extractArchive = async (archivePath: string, targetDir: string, extension: string) => {
  if (extension === 'zip') {
    await extract(archivePath, { dir: targetDir })
    return
  }
  await tar.x({ file: archivePath, cwd: targetDir })
}

const findJavaBinaryInDir = async (dir: string) => {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(dir, entry.name, 'bin', JAVA_FILENAME)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  const fallback = path.join(dir, 'bin', JAVA_FILENAME)
  return existsSync(fallback) ? fallback : null
}

const verifyJavaMajor = async (javaPath: string, expectedMajor: number) => {
  const parsed = await parseJavaVersion(javaPath)
  return parsed?.major === expectedMajor
}

class JavaInstallJob {
  id: string
  major: number
  listeners: Set<(event: JavaInstallEvent) => void>
  javaPath: string | null

  constructor(major: number) {
    this.id = crypto.randomUUID()
    this.major = major
    this.listeners = new Set()
    this.javaPath = null
  }

  emit(event: JavaInstallEvent) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  on(listener: (event: JavaInstallEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

class JavaInstallManager {
  private jobs = new Map<string, JavaInstallJob>()

  createJob(major: number) {
    const existing = Array.from(this.jobs.values()).find((job) => job.major === major)
    if (existing) return existing
    const job = new JavaInstallJob(major)
    this.jobs.set(job.id, job)
    return job
  }

  getJob(id: string) {
    return this.jobs.get(id)
  }

  async ensureInstalled(major: number) {
    const installDir = getManagedInstallDir(major)
    const javaBin = path.join(installDir, 'bin', JAVA_FILENAME)
    if (existsSync(javaBin) && (await verifyJavaMajor(javaBin, major))) {
      return { status: 'already_installed' as const, javaPath: javaBin }
    }

    const job = this.createJob(major)
    this.runInstall(job).catch((error) => {
      job.emit({ jobId: job.id, phase: 'error', progress: 100, message: error?.message })
    })
    return { status: 'started' as const, jobId: job.id }
  }

  private async runInstall(job: JavaInstallJob) {
    const { major } = job
    const installDir = getManagedInstallDir(major)
    await ensureDir(installDir)

    const { url, extension } = buildDownloadUrl(major)
    const downloadDir = getDownloadCacheDir()
    await ensureDir(downloadDir)
    const archivePath = path.join(downloadDir, `temurin-jre-${major}-${process.platform}-${process.arch}.${extension}`)

    job.emit({ jobId: job.id, phase: 'download', progress: 0 })
    await downloadToFile(url, archivePath, (progress) => {
      job.emit({ jobId: job.id, phase: 'download', progress })
    })

    job.emit({ jobId: job.id, phase: 'extract', progress: 5 })
    await extractArchive(archivePath, installDir, extension)
    job.emit({ jobId: job.id, phase: 'extract', progress: 60 })

    const javaBin = await findJavaBinaryInDir(installDir)
    if (!javaBin) {
      throw new Error('Java binary not found after extraction')
    }

    job.emit({ jobId: job.id, phase: 'verify', progress: 80 })
    const valid = await verifyJavaMajor(javaBin, major)
    if (!valid) {
      throw new Error(`Installed Java did not match expected major ${major}`)
    }

    job.javaPath = javaBin
    job.emit({ jobId: job.id, phase: 'done', progress: 100, javaPath: javaBin })
  }
}

export const javaInstallManager = new JavaInstallManager()

export const resolveJavaForInstance = async (
  instance: InstanceConfig,
  mcVersion?: string,
  serverType?: string,
) => {
  const recommendedMajor = getRecommendedJavaMajor(mcVersion ?? instance.minecraftVersion ?? '', serverType ?? instance.serverType)
  const candidates = await detectJavaCandidates()

  const javaConfig: JavaConfig = instance.java ?? {}
  const strategy = javaConfig.strategy ?? 'auto'
  const reasons: string[] = []

  const logNeedsJava = () => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[java] NEEDS_JAVA', {
        recommendedMajor,
        strategy,
        candidateCount: candidates.length,
        reasons,
      })
    }
  }

  const validatePath = async (customPath?: string) => {
    if (!customPath) return null
    const parsed = await parseJavaVersion(customPath)
    if (!parsed) {
      reasons.push(`Invalid Java binary at ${customPath}`)
      return null
    }
    if (parsed.major < recommendedMajor) {
      reasons.push(`Java at ${customPath} is version ${parsed.major}, below recommended ${recommendedMajor}`)
      return null
    }
    return parsed
  }

  const explicitPath = javaConfig.path ?? javaConfig.javaPath ?? instance.javaPath
  const explicitCandidate = await validatePath(explicitPath ?? undefined)
  if (explicitCandidate) {
    return { status: 'resolved' as const, javaBin: explicitCandidate.path, javaHome: undefined }
  }

  const allowedSources = strategy === 'auto' ? ['system', 'managed'] : [strategy]
  const filteredCandidates = candidates
    .filter((c) => allowedSources.includes(c.source))
    .filter((c) => c.major >= recommendedMajor)
    .sort((a, b) => a.major - b.major)

  for (const candidate of filteredCandidates) {
    const parsed = await parseJavaVersion(candidate.path)
    if (!parsed) {
      reasons.push(`Failed to parse Java version for ${candidate.path}`)
      continue
    }
    if (parsed.major < recommendedMajor) {
      reasons.push(`Java at ${candidate.path} is version ${parsed.major}, below recommended ${recommendedMajor}`)
      continue
    }

    const javaHome = candidate.source === 'managed' ? path.dirname(path.dirname(candidate.path)) : undefined
    return { status: 'resolved' as const, javaBin: candidate.path, javaHome }
  }

  reasons.push('No Java candidate matched strategy and version requirements')
  logNeedsJava()

  return { status: 'needs_java' as const, recommendedMajor, candidates }
}
