import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getDataDir } from '../config/paths'
import { LICENSE_PUBLIC_KEY } from '../config/licensePublicKey'

export type LicensePayload = {
  licenseId: string
  issuedAt: string
  expiresAt?: string
  edition?: string
  owner?: string
  deviceBinding?: 'required' | 'none'
  maxDevices?: number
  notes?: string
}

export type StoredLicense = {
  licenseToken: string
  activatedDeviceHash: string
  activatedAt: string
}

export type LicenseStatusCode =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'device_mismatch'
  | 'active'

export type LicenseStatus = {
  status: LicenseStatusCode
  message: string
  licenseId?: string
  issuedAt?: string
  expiresAt?: string
  edition?: string
  owner?: string
  deviceBinding?: LicensePayload['deviceBinding']
  maxDevices?: number
  notes?: string
  activatedAt?: string
  activatedDeviceHash?: string
}

type ParseResult = {
  header: { alg?: string; typ?: string }
  payload: LicensePayload
  signature: Buffer
  signingInput: Buffer
}

type ActivationResult =
  | { ok: true; status: LicenseStatus }
  | { ok: false; error: string; status?: LicenseStatusCode; message?: string; statusCode?: number }

const LICENSE_FILE_NAME = 'license.json'
const DEVICE_SALT_FILE = 'device.salt'
const DEVICE_ID_FILE = 'device.id'
const LICENSE_HEADER_TYP = 'AMP-LICENSE'
const LICENSE_ALG = 'Ed25519'

const resolveLicensePath = () => path.join(getDataDir(), LICENSE_FILE_NAME)
const resolveDeviceSaltPath = () => path.join(getDataDir(), DEVICE_SALT_FILE)
const resolveDeviceIdPath = () => path.join(getDataDir(), DEVICE_ID_FILE)

const base64UrlDecode = (input: string) => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = 4 - (padded.length % 4 || 4)
  const normalized = `${padded}${'='.repeat(padLength === 4 ? 0 : padLength)}`
  return Buffer.from(normalized, 'base64')
}

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

const parseLicenseToken = (token: string): ParseResult => {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('LICENSE_FORMAT_INVALID')
  }

  const [headerRaw, payloadRaw, signatureRaw] = parts
  const headerJson = base64UrlDecode(headerRaw).toString('utf-8')
  const payloadJson = base64UrlDecode(payloadRaw).toString('utf-8')

  const header = JSON.parse(headerJson)
  const payload = JSON.parse(payloadJson)

  if (header?.typ !== LICENSE_HEADER_TYP || header?.alg !== LICENSE_ALG) {
    throw new Error('LICENSE_HEADER_INVALID')
  }

  const signature = base64UrlDecode(signatureRaw)
  const signingInput = Buffer.from(`${headerRaw}.${payloadRaw}`)

  return { header, payload, signature, signingInput }
}

const verifySignature = (token: string): LicensePayload => {
  const { payload, signature, signingInput } = parseLicenseToken(token)

  const verified = crypto.verify(null, signingInput, LICENSE_PUBLIC_KEY, signature)
  if (!verified) {
    throw new Error('LICENSE_SIGNATURE_INVALID')
  }

  return payload
}

const isIsoDateValid = (value?: string) => {
  if (!value) return true
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

const checkExpiration = (payload: LicensePayload) => {
  if (!payload.expiresAt) return false
  const expires = new Date(payload.expiresAt)
  return expires.getTime() <= Date.now()
}

const getMachineId = (): string => {
  const candidates = [
    process.env.MACHINE_ID,
    readFileSafe('/etc/machine-id'),
    readFileSafe('/var/lib/dbus/machine-id'),
    readFileSafe(resolveDeviceIdPath()),
  ].filter(Boolean) as string[]

  if (candidates.length > 0) {
    const value = candidates[0].trim()
    if (value.length > 0) {
      return value
    }
  }

  const generated = crypto.randomUUID()
  try {
    fs.writeFileSync(resolveDeviceIdPath(), generated, 'utf-8')
  } catch (error) {
    // ignore persistence failure
  }
  return generated
}

const getDeviceSalt = (): string => {
  const saltPath = resolveDeviceSaltPath()
  const existing = readFileSafe(saltPath)
  if (existing && existing.trim().length > 0) return existing.trim()

  const salt = crypto.randomBytes(16).toString('hex')
  try {
    ensureDataDir()
    fs.writeFileSync(saltPath, salt, 'utf-8')
  } catch (error) {
    // ignore persistence failure
  }
  return salt
}

export const getDeviceFingerprintHash = (): string => {
  const parts = [os.platform(), os.arch(), os.release(), os.hostname(), getMachineId(), getDeviceSalt()]
  const fingerprint = parts.join('|')
  return crypto.createHash('sha256').update(fingerprint).digest('hex')
}

const readLicenseFile = (): StoredLicense | null => {
  try {
    const filePath = resolveLicensePath()
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as StoredLicense
    if (!parsed.licenseToken || !parsed.activatedDeviceHash) return null
    return parsed
  } catch (error) {
    return null
  }
}

const writeLicenseFile = (payload: StoredLicense) => {
  ensureDataDir()
  fs.writeFileSync(resolveLicensePath(), JSON.stringify(payload, null, 2), 'utf-8')
}

const removeLicenseFile = () => {
  try {
    const filePath = resolveLicensePath()
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (error) {
    // ignore
  }
}

const validatePayload = (payload: LicensePayload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('LICENSE_PAYLOAD_INVALID')
  }

  if (!payload.licenseId || typeof payload.licenseId !== 'string') {
    throw new Error('LICENSE_ID_MISSING')
  }

  if (!payload.issuedAt || !isIsoDateValid(payload.issuedAt)) {
    throw new Error('LICENSE_ISSUED_AT_INVALID')
  }

  if (!isIsoDateValid(payload.expiresAt)) {
    throw new Error('LICENSE_EXPIRES_AT_INVALID')
  }
}

export const getLicenseStatus = (): LicenseStatus => {
  const stored = readLicenseFile()
  if (!stored) {
    return { status: 'missing', message: 'Keine Lizenzdatei gefunden. Bitte Lizenz aktivieren.' }
  }

  let payload: LicensePayload
  try {
    payload = verifySignature(stored.licenseToken)
    validatePayload(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Lizenzfehler'
    return { status: 'invalid', message, activatedDeviceHash: stored.activatedDeviceHash }
  }

  const expired = checkExpiration(payload)
  if (expired) {
    return {
      status: 'expired',
      message: 'Lizenz ist abgelaufen.',
      licenseId: payload.licenseId,
      expiresAt: payload.expiresAt,
      issuedAt: payload.issuedAt,
      edition: payload.edition,
      owner: payload.owner,
      maxDevices: payload.maxDevices,
      notes: payload.notes,
      deviceBinding: payload.deviceBinding,
      activatedDeviceHash: stored.activatedDeviceHash,
      activatedAt: stored.activatedAt,
    }
  }

  const currentHash = getDeviceFingerprintHash()
  const requiresBinding = payload.deviceBinding !== 'none'
  if (requiresBinding && stored.activatedDeviceHash !== currentHash) {
    return {
      status: 'device_mismatch',
      message: 'Lizenz ist an ein anderes Gerät gebunden. Bitte erneut aktivieren.',
      licenseId: payload.licenseId,
      expiresAt: payload.expiresAt,
      issuedAt: payload.issuedAt,
      edition: payload.edition,
      owner: payload.owner,
      maxDevices: payload.maxDevices,
      notes: payload.notes,
      deviceBinding: payload.deviceBinding,
      activatedDeviceHash: stored.activatedDeviceHash,
      activatedAt: stored.activatedAt,
    }
  }

  return {
    status: 'active',
    message: 'Lizenz gültig.',
    licenseId: payload.licenseId,
    expiresAt: payload.expiresAt,
    issuedAt: payload.issuedAt,
    edition: payload.edition,
    owner: payload.owner,
    maxDevices: payload.maxDevices,
    notes: payload.notes,
    deviceBinding: payload.deviceBinding,
    activatedDeviceHash: stored.activatedDeviceHash,
    activatedAt: stored.activatedAt,
  }
}

export const activateLicense = (licenseToken: string): ActivationResult => {
  if (!licenseToken || typeof licenseToken !== 'string') {
    return { ok: false, error: 'LICENSE_TOKEN_REQUIRED', message: 'Lizenzschlüssel fehlt.' }
  }

  let payload: LicensePayload
  try {
    payload = verifySignature(licenseToken)
    validatePayload(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Lizenzfehler'
    return { ok: false, error: 'LICENSE_INVALID', message, status: 'invalid', statusCode: 400 }
  }

  if (checkExpiration(payload)) {
    return {
      ok: false,
      error: 'LICENSE_EXPIRED',
      message: 'Lizenz ist abgelaufen.',
      status: 'expired',
      statusCode: 402,
    }
  }

  const existing = readLicenseFile()
  const currentHash = getDeviceFingerprintHash()
  const requiresBinding = payload.deviceBinding !== 'none'

  if (
    requiresBinding &&
    existing?.activatedDeviceHash &&
    existing.activatedDeviceHash !== currentHash
  ) {
    return {
      ok: false,
      error: 'DEVICE_MISMATCH',
      message: 'Lizenz ist bereits auf einem anderen Gerät aktiviert. Bitte alte Aktivierung entfernen.',
      status: 'device_mismatch',
      statusCode: 409,
    }
  }

  const stored: StoredLicense = {
    licenseToken,
    activatedDeviceHash: currentHash,
    activatedAt: new Date().toISOString(),
  }

  try {
    writeLicenseFile(stored)
  } catch (error) {
    return {
      ok: false,
      error: 'LICENSE_WRITE_FAILED',
      message: 'Lizenz konnte nicht gespeichert werden.',
      status: 'invalid',
      statusCode: 500,
    }
  }

  return { ok: true, status: getLicenseStatus() }
}

export const deleteLicense = () => {
  removeLicenseFile()
}

export const licenseGuardMiddleware: import('express').RequestHandler = (_req, res, next) => {
  const status = getLicenseStatus()
  if (status.status === 'active') {
    return next()
  }

  const httpStatus = status.status === 'expired' ? 402 : 403
  return res.status(httpStatus).json({ error: 'LICENSE_REQUIRED', message: status.message, status: status.status })
}

