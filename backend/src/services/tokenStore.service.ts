import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDataDir } from '../config/paths'
import { getDeviceId } from './device.service'

type StoredTokens = {
  accessToken: string
  refreshToken: string
  accessExpiresAt: string
  refreshExpiresAt?: string
  remember: boolean
  user?: {
    id?: string
    email?: string
    name?: string
  }
}

type KeytarModule = typeof import('keytar')

const SERVICE_NAME = 'minecraft-amp'
const ACCOUNT_NAME = 'auth-session'
const TOKEN_FILE = path.join(getDataDir(), 'auth.tokens.enc')
const TOKEN_SALT_FILE = path.join(getDataDir(), 'auth.tokens.salt')

let cachedTokens: StoredTokens | null = null
let volatileTokens: StoredTokens | null = null

const loadKeytar = (): KeytarModule | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('keytar')
  } catch (error) {
    return null
  }
}

const ensureDataDir = () => {
  fs.mkdirSync(getDataDir(), { recursive: true })
}

const readFileSafe = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  } catch (error) {
    return null
  }
}

const writeFileSafe = (filePath: string, payload: Buffer | string) => {
  ensureDataDir()
  fs.writeFileSync(filePath, payload, { encoding: typeof payload === 'string' ? 'utf-8' : undefined, mode: 0o600 })
}

const removeFileSafe = (filePath: string) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (error) {
    // ignore
  }
}

const getTokenSalt = (): string => {
  const existing = readFileSafe(TOKEN_SALT_FILE)
  if (existing) return existing.toString('utf-8')

  const salt = crypto.randomBytes(16).toString('hex')
  writeFileSafe(TOKEN_SALT_FILE, salt)
  return salt
}

const getEncryptionKey = () => {
  const salt = getTokenSalt()
  return crypto.scryptSync(getDeviceId(), salt, 32)
}

const encryptPayload = (payload: StoredTokens) => {
  const iv = crypto.randomBytes(12)
  const key = getEncryptionKey()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const json = JSON.stringify(payload)
  const encrypted = Buffer.concat([cipher.update(json, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted])
}

const decryptPayload = (payload: Buffer): StoredTokens | null => {
  try {
    if (payload.length < 28) return null
    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const encrypted = payload.subarray(28)
    const key = getEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8')
    return JSON.parse(decrypted) as StoredTokens
  } catch (error) {
    return null
  }
}

const readFromKeytar = async () => {
  const keytar = loadKeytar()
  if (!keytar) return null
  const value = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME)
  if (!value) return null
  try {
    return JSON.parse(value) as StoredTokens
  } catch (error) {
    return null
  }
}

const writeToKeytar = async (tokens: StoredTokens) => {
  const keytar = loadKeytar()
  if (!keytar) return false
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(tokens))
  return true
}

const removeFromKeytar = async () => {
  const keytar = loadKeytar()
  if (!keytar) return false
  await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
  return true
}

const readFromFile = () => {
  const raw = readFileSafe(TOKEN_FILE)
  if (!raw) return null
  return decryptPayload(raw)
}

const writeToFile = (tokens: StoredTokens) => {
  const encrypted = encryptPayload(tokens)
  writeFileSafe(TOKEN_FILE, encrypted)
}

const removeFromFile = () => {
  removeFileSafe(TOKEN_FILE)
}

export const getStoredTokens = async (): Promise<StoredTokens | null> => {
  if (volatileTokens) return volatileTokens
  if (cachedTokens) return cachedTokens

  const keytarTokens = await readFromKeytar()
  if (keytarTokens) {
    cachedTokens = keytarTokens
    return keytarTokens
  }

  const fileTokens = readFromFile()
  if (fileTokens) {
    cachedTokens = fileTokens
    return fileTokens
  }

  return null
}

export const saveStoredTokens = async (tokens: StoredTokens, persist: boolean) => {
  cachedTokens = tokens
  if (!persist) {
    volatileTokens = tokens
    await removeFromKeytar()
    removeFromFile()
    return
  }

  volatileTokens = null
  const storedInKeytar = await writeToKeytar(tokens)
  if (!storedInKeytar) {
    writeToFile(tokens)
  } else {
    removeFromFile()
  }
}

export const clearStoredTokens = async () => {
  cachedTokens = null
  volatileTokens = null
  await removeFromKeytar()
  removeFromFile()
}

export type { StoredTokens }
