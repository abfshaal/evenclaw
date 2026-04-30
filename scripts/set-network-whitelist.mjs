#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'

const appJsonPath = new URL('../app.json', import.meta.url)
const runtimeConfigPath = new URL('../public/ocuclaw-config.json', import.meta.url)
const port = process.env.OCUCLAW_PROXY_PORT || '8787'

function firstLanIp() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return '127.0.0.1'
}

const origin = process.argv[2] || `http://${firstLanIp()}:${port}`
const appJson = JSON.parse(await readFile(appJsonPath, 'utf8'))
const networkPermission = appJson.permissions.find((permission) => permission.name === 'network')

if (!networkPermission) throw new Error('app.json missing network permission')
networkPermission.whitelist = [origin]

await writeFile(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

const runtimeConfig = {
  proxyUrl: origin,
}

await mkdir(new URL('../public', import.meta.url), { recursive: true })
await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`)

console.log(`Set app.json network whitelist to ${origin}`)
console.log('Wrote public/ocuclaw-config.json with proxyUrl')
