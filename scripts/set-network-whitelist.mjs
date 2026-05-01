#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'

const appJsonPath = new URL('../app.json', import.meta.url)
const runtimeConfigPath = new URL('../public/glasses-claw-config.json', import.meta.url)
const port = process.env.GLASSES_CLAW_PROXY_PORT || process.env.OCUCLAW_PROXY_PORT || '8787'
const PROXY_KEY_PATH = join(homedir(), '.glasses-claw', 'proxy-key')
const LEGACY_PROXY_KEY_PATH = join(homedir(), '.openclaw', 'ocuclaw-proxy-key')

function firstLanIp() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return '127.0.0.1'
}

async function resolveProxyKey() {
  if (process.env.GLASSES_CLAW_PROXY_KEY?.trim()) return process.env.GLASSES_CLAW_PROXY_KEY.trim()
  if (process.env.OCUCLAW_PROXY_KEY?.trim()) return process.env.OCUCLAW_PROXY_KEY.trim()
  try {
    let key = (await readFile(PROXY_KEY_PATH, 'utf8')).trim()
    if (key) return key
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const key = (await readFile(LEGACY_PROXY_KEY_PATH, 'utf8')).trim()
    if (key) return key
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return ''
}

const origin = process.argv[2] || `http://${firstLanIp()}:${port}`
const appJson = JSON.parse(await readFile(appJsonPath, 'utf8'))
const networkPermission = appJson.permissions.find((permission) => permission.name === 'network')

if (!networkPermission) throw new Error('app.json missing network permission')
networkPermission.whitelist = [origin]

await writeFile(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

const proxyKey = await resolveProxyKey()
if (!proxyKey) {
  throw new Error(`No proxy key found. Set GLASSES_CLAW_PROXY_KEY env or run the proxy once to generate ${PROXY_KEY_PATH}.`)
}

const runtimeConfig = {
  proxyUrl: origin,
  proxyKey,
}

await mkdir(new URL('../public', import.meta.url), { recursive: true })
await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`)

console.log(`Set app.json network whitelist to ${origin}`)
console.log(`Wrote public/glasses-claw-config.json with proxyUrl + proxyKey (${proxyKey.length}-char key baked in)`)
