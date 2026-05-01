#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const target = process.argv[2]

const PRESETS = {
  local: {
    GLASSES_CLAW_TRANSCRIPTION_BASE_URL: 'http://127.0.0.1:9001',
    GLASSES_CLAW_TRANSCRIPTION_PATH: '/inference',
    OPENCLAW_TRANSCRIPTION_MODEL: 'whisper-1',
  },
  core42: {
    OPENAI_BASE_URL: 'https://api.core42.ai/v1',
    OPENCLAW_TRANSCRIPTION_MODEL: 'whisper-1',
  },
  openai: {
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENCLAW_TRANSCRIPTION_MODEL: 'whisper-1',
  },
}

if (!target || !PRESETS[target]) {
  console.error(`usage: node scripts/use-whisper-target.mjs <${Object.keys(PRESETS).join('|')}>`)
  process.exit(1)
}

const env = PRESETS[target]
const path = '.env'
let body = existsSync(path) ? readFileSync(path, 'utf8') : ''

const transcriptionKeys = [
  'GLASSES_CLAW_TRANSCRIPTION_BASE_URL',
  'GLASSES_CLAW_TRANSCRIPTION_PATH',
  'OCUCLAW_TRANSCRIPTION_BASE_URL',
  'OCUCLAW_TRANSCRIPTION_PATH',
  'OPENCLAW_TRANSCRIPTION_MODEL',
  'OPENAI_BASE_URL',
]

const lines = body.split('\n').map((line) => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return line
  const eq = trimmed.indexOf('=')
  if (eq === -1) return line
  const key = trimmed.slice(0, eq)
  if (transcriptionKeys.includes(key)) return `# ${line}`
  return line
})

for (const [key, value] of Object.entries(env)) {
  lines.push(`${key}=${value}`)
}

writeFileSync(path, lines.join('\n').replace(/\n{3,}/g, '\n\n'))
console.log(`[use-whisper-target] .env switched to '${target}' preset:`)
for (const [key, value] of Object.entries(env)) console.log(`  ${key}=${value}`)
if (target === 'local') {
  console.log('next: run `npm run whisper:local` then restart `npm run proxy`')
} else {
  console.log('next: ensure OPENAI_API_KEY is set in .env, then restart `npm run proxy`')
}
