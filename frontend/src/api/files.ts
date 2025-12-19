import { apiUrl } from '../config'

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  path: string
  size?: number
  modified?: string
}

interface ApiError extends Error {
  status?: number
  data?: unknown
}

const pathParam = (path: string) => encodeURIComponent(path || '/')

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

  const error = new Error(message) as ApiError
  error.status = response.status
  error.data = payload
  return error
}

const parseJson = async (response: Response) => {
  try {
    return await response.json()
  } catch (error) {
    return undefined
  }
}

const request = (path: string, options?: RequestInit) => {
  const url = apiUrl(path)
  // eslint-disable-next-line no-console
  console.log('[api] Requesting', url)
  return fetch(url, options)
}

const handleResponse = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  const payload = await parseJson(response)

  if (!response.ok) {
    throw buildApiError(response, payload, fallbackMessage)
  }

  return payload as T
}

/**
 * Backend endpoint: GET /api/instances/:id/files?path=path
 * Responds with { id, path, entries: { name, type: 'dir' | 'file', size, mtime }[] }
 */
export async function listFiles(
  instanceId: string,
  path = '/',
  signal?: AbortSignal,
): Promise<FileEntry[]> {
  const response = await request(
    `/api/instances/${instanceId}/files?path=${pathParam(path)}`,
    { signal },
  )

  const payload = await handleResponse<{
    entries?: { name: string; type: 'dir' | 'file'; size?: number; mtime?: string }[]
    path?: string
  }>(response, 'Failed to load files')

  const basePath = payload.path && payload.path !== '/' ? payload.path : ''
  const entries = Array.isArray(payload.entries) ? payload.entries : []

  return entries.map((entry) => ({
    name: entry.name,
    type: entry.type === 'dir' ? 'directory' : 'file',
    path: [basePath, entry.name].filter(Boolean).join('/'),
    size: entry.size,
    modified: entry.mtime,
  }))
}

export async function downloadFile(instanceId: string, path: string): Promise<Blob> {
  const response = await request(
    `/api/instances/${instanceId}/files/download?path=${pathParam(path)}`,
  )
  if (!response.ok) {
    throw buildApiError(response, await parseJson(response), 'Failed to download file')
  }
  return response.blob()
}

export async function uploadFile(
  instanceId: string,
  path: string,
  file: File,
): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)
  const targetPath = path || '/'
  const response = await request(
    `/api/instances/${instanceId}/files/upload?path=${pathParam(targetPath)}`,
    {
      method: 'POST',
      body: formData,
    },
  )
  if (!response.ok) {
    throw buildApiError(response, await parseJson(response), 'Upload failed')
  }
}

export async function deleteEntry(instanceId: string, path: string): Promise<void> {
  const response = await request(
    `/api/instances/${instanceId}/files?path=${pathParam(path)}`,
    {
      method: 'DELETE',
    },
  )

  await handleResponse(response, 'Failed to delete path')
}

export async function readFile(instanceId: string, path: string): Promise<string> {
  const response = await request(
    `/api/instances/${instanceId}/files/text?path=${pathParam(path)}`,
  )

  const payload = await handleResponse<{ content?: string }>(
    response,
    'Failed to read file',
  )

  return payload.content ?? ''
}

export async function writeFile(
  instanceId: string,
  path: string,
  content: string,
): Promise<void> {
  const response = await request(`/api/instances/${instanceId}/files/text`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, content, overwrite: true }),
  })

  await handleResponse(response, 'Failed to save file')
}
