import { API_BASE, apiUrl, isElectronApp, runtimeConfig } from './api/base'

export type RuntimeConfig = typeof runtimeConfig

export const API_KEY = runtimeConfig.apiKey || import.meta.env.VITE_API_KEY || ''
export const SUPPORT_WEBSITE = 'https://zbennoz.com'

export { API_BASE, apiUrl, isElectronApp, runtimeConfig }
