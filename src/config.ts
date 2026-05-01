export const DEFAULT_PROXY_PORT = 8787
export const PROXY_URL_STORAGE_KEY = 'glasses-claw.proxyUrl'
export const PROXY_KEY_STORAGE_KEY = 'glasses-claw.proxyKey'
export const SESSION_ID_STORAGE_KEY = 'glasses-claw.sessionId'
const LEGACY_PROXY_URL_STORAGE_KEY = 'ocuclaw.proxyUrl'
const LEGACY_PROXY_KEY_STORAGE_KEY = 'ocuclaw.proxyKey'
const LEGACY_SESSION_ID_STORAGE_KEY = 'ocuclaw.sessionId'

export type RuntimeConfig = {
  proxyUrl?: string
  proxyKey?: string
}

export function normalizeProxyUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function inferDefaultProxyUrl(): string {
  const envUrl = import.meta.env.VITE_GLASSES_CLAW_PROXY_URL || import.meta.env.VITE_OPENCLAW_PROXY_URL
  if (typeof envUrl === 'string' && envUrl.trim()) {
    return normalizeProxyUrl(envUrl)
  }

  if (location.protocol === 'http:' && location.hostname && location.hostname !== 'localhost') {
    return `http://${location.hostname}:${DEFAULT_PROXY_PORT}`
  }

  return `http://127.0.0.1:${DEFAULT_PROXY_PORT}`
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  for (const path of ['/glasses-claw-config.json', '/ocuclaw-config.json']) {
    try {
      const response = await fetch(path, { cache: 'no-store' })
      if (response.ok) return (await response.json()) as RuntimeConfig
    } catch {
      // Try next config path.
    }
  }
  return {}
}

export function loadProxyUrl(configUrl?: string): string {
  const saved = localStorage.getItem(PROXY_URL_STORAGE_KEY) || localStorage.getItem(LEGACY_PROXY_URL_STORAGE_KEY)
  if (saved?.trim()) return normalizeProxyUrl(saved)
  if (configUrl?.trim()) return normalizeProxyUrl(configUrl)
  return inferDefaultProxyUrl()
}

export function saveProxyUrl(value: string): string {
  const normalized = normalizeProxyUrl(value)
  localStorage.setItem(PROXY_URL_STORAGE_KEY, normalized)
  return normalized
}

export function loadProxyKey(configKey?: string): string {
  const saved = localStorage.getItem(PROXY_KEY_STORAGE_KEY) || localStorage.getItem(LEGACY_PROXY_KEY_STORAGE_KEY)
  if (saved?.trim()) return saved.trim()
  return configKey?.trim() || ''
}

export function saveProxyKey(value: string): string {
  const normalized = value.trim()
  localStorage.setItem(PROXY_KEY_STORAGE_KEY, normalized)
  return normalized
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `glasses-claw-${crypto.randomUUID()}`
  }
  return `glasses-claw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function loadSessionId(): string {
  const saved = localStorage.getItem(SESSION_ID_STORAGE_KEY) || localStorage.getItem(LEGACY_SESSION_ID_STORAGE_KEY)
  if (saved?.trim()) return saved.trim()
  const fresh = generateSessionId()
  localStorage.setItem(SESSION_ID_STORAGE_KEY, fresh)
  return fresh
}

export function rotateSessionId(): string {
  const fresh = generateSessionId()
  localStorage.setItem(SESSION_ID_STORAGE_KEY, fresh)
  return fresh
}
