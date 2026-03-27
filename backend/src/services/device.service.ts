import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pkg from '../../package.json'
import { getDataDir } from '../config/paths'

const DEVICE_ID_FILE = 'device.id'
const DEVICE_META_FILE = 'device.meta.json'
const INSTALLATION_ID_FILE = 'installation.id'

type DeviceMeta = {
  version: 2
  primaryId: string
  aliases: string[]
  machineFingerprint: string
  createdAt: string
  updatedAt: string
}

const resolveDeviceIdPath = () => path.join(getDataDir(), DEVICE_ID_FILE)
const resolveDeviceMetaPath = () => path.join(getDataDir(), DEVICE_META_FILE)
const resolveInstallationIdPath = () => path.join(getDataDir(), INSTALLATION_ID_FILE)

const readFileSafe = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch (_error) {
    return null
  }
}

const ensureDataDir = () => {
  fs.mkdirSync(getDataDir(), { recursive: true })
}

const removeFileSafe = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return true
    }
  } catch (_error) {
    // ignore
  }
  return false
}

const readMetaSafe = (): DeviceMeta | null => {
  try {
    const raw = readFileSafe(resolveDeviceMetaPath())
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceMeta>
    if (parsed.version !== 2) return null
    if (typeof parsed.primaryId !== 'string' || !parsed.primaryId.trim()) return null
    if (!Array.isArray(parsed.aliases)) return null
    if (typeof parsed.machineFingerprint !== 'string' || !parsed.machineFingerprint.trim()) return null
    return {
      version: 2,
      primaryId: parsed.primaryId,
      aliases: parsed.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0),
      machineFingerprint: parsed.machineFingerprint,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch (_error) {
    return null
  }
}

const writeMetaSafe = (meta: DeviceMeta) => {
  try {
    ensureDataDir()
    fs.writeFileSync(resolveDeviceMetaPath(), JSON.stringify(meta, null, 2), { encoding: 'utf-8', mode: 0o600 })
  } catch (_error) {
    // ignore
  }
}

const sanitizeMachineId = (value: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const readMachineId = (): string | null => {
  const candidates = [
    sanitizeMachineId(process.env.MACHINE_ID ?? null),
    sanitizeMachineId(readFileSafe('/etc/machine-id')),
    sanitizeMachineId(readFileSafe('/var/lib/dbus/machine-id')),
  ]

  return candidates.find(Boolean) ?? null
}

const getInstallationId = (): string => {
  const existing = sanitizeMachineId(readFileSafe(resolveInstallationIdPath()))
  if (existing) return existing

  const installationId = crypto.randomUUID()
  try {
    ensureDataDir()
    fs.writeFileSync(resolveInstallationIdPath(), installationId, { encoding: 'utf-8', mode: 0o600 })
  } catch (_error) {
    // ignore
  }
  return installationId
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex')

const getMachineFingerprint = () => {
  const machineId = readMachineId() ?? 'unknown-machine-id'
  return sha256(`${machineId}|${os.hostname()}|${os.platform()}|${os.arch()}|${os.release()}`)
}

const buildDeviceIdentity = () => {
  const machineId = readMachineId()
  const installationId = getInstallationId()

  const primaryRaw = machineId
    ? `v2:machine:${machineId}|${os.platform()}|${os.arch()}`
    : `v2:install:${installationId}|${os.platform()}|${os.arch()}`

  const primaryId = sha256(primaryRaw)
  const aliases = [
    sha256(`legacy:${machineId ?? os.hostname()}|${os.platform()}|${os.arch()}`),
    sha256(`install:${installationId}|${os.platform()}|${os.arch()}`),
  ].filter((value, index, values) => values.indexOf(value) === index && value !== primaryId)

  return { primaryId, aliases, machineFingerprint: getMachineFingerprint() }
}

const persistDeviceIdentity = () => {
  const identity = buildDeviceIdentity()
  const now = new Date().toISOString()
  const meta: DeviceMeta = {
    version: 2,
    primaryId: identity.primaryId,
    aliases: identity.aliases,
    machineFingerprint: identity.machineFingerprint,
    createdAt: now,
    updatedAt: now,
  }

  try {
    ensureDataDir()
    fs.writeFileSync(resolveDeviceIdPath(), identity.primaryId, { encoding: 'utf-8', mode: 0o600 })
  } catch (_error) {
    // ignore persistence failure
  }

  writeMetaSafe(meta)
  return meta
}

const syncMetaIfNeeded = (primaryId: string) => {
  const existingMeta = readMetaSafe()
  const computed = buildDeviceIdentity()
  if (
    existingMeta &&
    existingMeta.primaryId === primaryId &&
    existingMeta.machineFingerprint === computed.machineFingerprint &&
    computed.aliases.every((alias) => existingMeta.aliases.includes(alias))
  ) {
    return existingMeta
  }

  const now = new Date().toISOString()
  const meta: DeviceMeta = {
    version: 2,
    primaryId,
    aliases: [
      ...new Set([...(existingMeta?.aliases ?? []), ...computed.aliases].filter((alias) => alias && alias !== primaryId)),
    ],
    machineFingerprint: computed.machineFingerprint,
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now,
  }

  writeMetaSafe(meta)
  return meta
}

export const getDeviceId = (): string => {
  const existing = sanitizeMachineId(readFileSafe(resolveDeviceIdPath()))
  if (existing) {
    syncMetaIfNeeded(existing)
    return existing
  }

  return persistDeviceIdentity().primaryId
}

export const getDeviceInfo = () => {
  const id = getDeviceId()
  const meta = syncMetaIfNeeded(id)

  return {
    id,
    aliases: meta.aliases,
    fingerprint: meta.machineFingerprint,
    name: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    appVersion: pkg.version ?? '0.0.0',
  }
}

export const clearDeviceCache = () => {
  const deviceIdDeleted = removeFileSafe(resolveDeviceIdPath())
  const deviceMetaDeleted = removeFileSafe(resolveDeviceMetaPath())
  const installationIdDeleted = removeFileSafe(resolveInstallationIdPath())
  return { deviceIdDeleted, deviceMetaDeleted, installationIdDeleted }
}
