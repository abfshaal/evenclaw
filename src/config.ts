export const DEFAULT_PROXY_PORT = 8787
export const PROXY_URL_STORAGE_KEY = 'ocuclaw.proxyUrl'
export const PROXY_KEY_STORAGE_KEY = 'ocuclaw.proxyKey'

export type RuntimeConfig = {
  proxyUrl?: string
  proxyKey?: string
}

export function normalizeProxyUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function inferDefaultProxyUrl(): string {
  const envUrl = import.meta.env.VITE_OPENCLAW_PROXY_URL
  if (typeof envUrl === 'string' && envUrl.trim()) {
    return normalizeProxyUrl(envUrl)
  }

  if (location.protocol === 'http:' && location.hostname && location.hostname !== 'localhost') {
    return `http://${location.hostname}:${DEFAULT_PROXY_PORT}`
  }

  return `http://127.0.0.1:${DEFAULT_PROXY_PORT}`
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/ocuclaw-config.json', { cache: 'no-store' })
    if (!response.ok) return {}
    return (await response.json()) as RuntimeConfig
  } catch {
    return {}
  }
}

export function loadProxyUrl(configUrl?: string): string {
  const saved = localStorage.getItem(PROXY_URL_STORAGE_KEY)
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
  const saved = localStorage.getItem(PROXY_KEY_STORAGE_KEY)
  if (saved?.trim()) return saved.trim()
  return configKey?.trim() || ''
}

export function saveProxyKey(value: string): string {
  const normalized = value.trim()
  localStorage.setItem(PROXY_KEY_STORAGE_KEY, normalized)
  return normalized
}
