export type AppRuntimeConfig = {
  apiBase?: string
  apiKey?: string
  isElectron?: boolean
  apiBaseUrl?: string
  platform?: string
  appDataDir?: string
  appLogDir?: string
  port?: number | null
  supportWebsite?: string
}

declare global {
  interface Window {
    __APP_CONFIG__?: AppRuntimeConfig
    appConfig?: AppRuntimeConfig
    process?: { type?: string }
  }
}

const getRuntimeConfig = (): AppRuntimeConfig => {
  if (typeof window === 'undefined') return {}
  return window.__APP_CONFIG__ ?? window.appConfig ?? {}
}

const runtimeConfig = getRuntimeConfig()

const isElectronApp = Boolean(
  runtimeConfig.isElectron ?? (typeof window !== 'undefined' && window.process?.type === 'renderer'),
)

const configuredApiBase =
  runtimeConfig.apiBase ?? runtimeConfig.apiBaseUrl ?? import.meta.env.VITE_API_BASE ?? ''

const normalizedApiBase = configuredApiBase ? configuredApiBase.replace(/\/$/, '') : ''

export const API_BASE = isElectronApp && normalizedApiBase ? normalizedApiBase : ''

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE) return normalizedPath
  return `${API_BASE}${normalizedPath}`
}

export { isElectronApp, runtimeConfig }
