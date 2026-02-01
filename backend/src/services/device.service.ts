import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pkg from '../../package.json'
import { getDataDir } from '../config/paths'

const DEVICE_ID_FILE = 'device.id'
const DEVICE_SALT_FILE = 'device.salt'

const resolveDeviceIdPath = () => path.join(getDataDir(), DEVICE_ID_FILE)
const resolveDeviceSaltPath = () => path.join(getDataDir(), DEVICE_SALT_FILE)

const readFileSafe = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    return null
  }
}

const ensureDataDir = () => {
  fs.mkdirSync(getDataDir(), { recursive: true })
}

const getMachineId = (): string => {
  const candidates = [
    process.env.MACHINE_ID,
    readFileSafe('/etc/machine-id'),
    readFileSafe('/var/lib/dbus/machine-id'),
  ].filter(Boolean) as string[]

  if (candidates.length > 0) {
    const value = candidates[0].trim()
    if (value.length > 0) {
      return value
    }
  }

  return os.hostname()
}

const getDeviceSalt = (): string => {
  const existing = readFileSafe(resolveDeviceSaltPath())
  if (existing && existing.trim().length > 0) return existing.trim()

  const salt = crypto.randomBytes(16).toString('hex')
  try {
    ensureDataDir()
    fs.writeFileSync(resolveDeviceSaltPath(), salt, 'utf-8')
  } catch (error) {
    // ignore persistence failure
  }
  return salt
}

export const getDeviceId = (): string => {
  const existing = readFileSafe(resolveDeviceIdPath())
  if (existing && existing.trim().length > 0) return existing.trim()

  const raw = `${getMachineId()}|${os.platform()}|${os.arch()}|${getDeviceSalt()}`
  const deviceId = crypto.createHash('sha256').update(raw).digest('hex')
  try {
    ensureDataDir()
    fs.writeFileSync(resolveDeviceIdPath(), deviceId, 'utf-8')
  } catch (error) {
    // ignore persistence failure
  }
  return deviceId
}

export const getDeviceInfo = () => ({
  id: getDeviceId(),
  name: os.hostname(),
  platform: os.platform(),
  arch: os.arch(),
  osRelease: os.release(),
  appVersion: pkg.version ?? '0.0.0',
})
