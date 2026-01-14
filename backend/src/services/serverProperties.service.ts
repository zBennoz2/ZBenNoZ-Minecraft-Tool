import { promises as fs } from 'fs'
import path from 'path'
import { getInstanceServerDir } from '../config/paths'
import { InstanceConfig } from '../core/types'

export const DEFAULT_SERVER_PORT = 25565

export type ServerProperties = Record<string, string>

export const parsePropertiesNumber = (value?: string): number | null => {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export const readServerProperties = async (id: string): Promise<ServerProperties | null> => {
  const serverDir = getInstanceServerDir(id)
  const propertiesPath = path.join(serverDir, 'server.properties')
  try {
    const raw = await fs.readFile(propertiesPath, 'utf-8')
    const result: ServerProperties = {}
    for (const line of raw.split(/\n+/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [key, ...rest] = trimmed.split('=')
      if (!key) continue
      result[key.trim()] = rest.join('=').trim()
    }
    return result
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    console.error(`Failed to read server.properties for ${id}`, error)
    return null
  }
}

export const extractServerPort = (properties?: ServerProperties | null): number | null => {
  if (!properties) return null
  const candidate = properties['server-port'] ?? properties['server_port']
  return parsePropertiesNumber(candidate) ?? null
}

export const extractMaxPlayers = (properties?: ServerProperties | null): number | null => {
  if (!properties) return null
  return parsePropertiesNumber(properties['max-players'])
}

export const resolveServerPort = async (id: string): Promise<number> => {
  const properties = await readServerProperties(id)
  return extractServerPort(properties) ?? DEFAULT_SERVER_PORT
}

export const resolveServerPortForInstance = async (instance: InstanceConfig): Promise<number> => {
  if (instance.serverType === 'hytale') {
    return instance.hytale?.port ?? 5520
  }
  return resolveServerPort(instance.id)
}

export const resolveMaxPlayers = async (id: string): Promise<number | null> => {
  const properties = await readServerProperties(id)
  return extractMaxPlayers(properties)
}
