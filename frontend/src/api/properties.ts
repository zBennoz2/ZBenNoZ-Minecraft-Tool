import { apiUrl } from '../config'

/**
 * Backend routes (confirmed):
 *  - GET /api/instances/:id/server-properties
 *      → { id, path: 'server/server.properties', exists: boolean, properties: Record<string,string>, raw: string }
 *  - PUT /api/instances/:id/server-properties
 *      → accepts JSON body `{ raw: string }` or `{ set: object, unset: string[] }` and returns the same payload shape as GET
 */

export interface ServerPropertiesResponse {
  id: string
  path: string
  exists: boolean
  properties: Record<string, string>
  raw: string
}

interface ApiError extends Error {
  status?: number
  data?: unknown
}

const parseJson = async (response: Response) => {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

const buildApiError = (response: Response, payload: unknown, fallback: string) => {
  const message = (() => {
    if (typeof payload === 'string' && payload.trim().length > 0) return payload
    if (payload && typeof payload === 'object') {
      const errorField = (payload as { error?: unknown }).error
      const messageField = (payload as { message?: unknown }).message
      if (errorField) return String(errorField)
      if (messageField) return String(messageField)
    }
    return fallback
  })()

  const error = new Error(`[${response.status}] ${message}`) as ApiError
  error.status = response.status
  error.data = payload
  return error
}

const handleResponse = async <T>(response: Response, fallback: string): Promise<T> => {
  const payload = await parseJson(response)
  if (!response.ok) {
    throw buildApiError(response, payload, fallback)
  }
  return payload as T
}

const request = (path: string, options?: RequestInit) => {
  const url = apiUrl(path)
  // eslint-disable-next-line no-console
  console.log('[api] Requesting', url)
  return fetch(url, options)
}

export async function readServerProperties(instanceId: string): Promise<ServerPropertiesResponse> {
  const response = await request(`/api/instances/${instanceId}/server-properties`)
  return handleResponse<ServerPropertiesResponse>(
    response,
    'Failed to load server.properties',
  )
}

/**
 * Schreibt die komplette Datei neu (raw).
 */
export async function writeServerProperties(
  instanceId: string,
  content: string,
): Promise<ServerPropertiesResponse> {
  const response = await request(`/api/instances/${instanceId}/server-properties`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: content }),
  })

  return handleResponse<ServerPropertiesResponse>(
    response,
    'Failed to save server.properties',
  )
}

/**
 * Setzt gezielt Properties (key/value).
 */
export async function setServerProperties(
  instanceId: string,
  properties: Record<string, string>,
): Promise<ServerPropertiesResponse> {
  const response = await request(`/api/instances/${instanceId}/server-properties`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ set: properties }),
  })

  return handleResponse<ServerPropertiesResponse>(
    response,
    'Failed to update server.properties',
  )
}

/**
 * Entfernt gezielt Properties anhand der Keys.
 */
export async function unsetServerProperties(
  instanceId: string,
  keys: string[],
): Promise<ServerPropertiesResponse> {
  const response = await request(`/api/instances/${instanceId}/server-properties`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unset: keys }),
  })

  return handleResponse<ServerPropertiesResponse>(
    response,
    'Failed to remove properties',
  )
}
