#!/usr/bin/env node
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'

const PROXY_HOST = process.env.OCUCLAW_PROXY_HOST || '0.0.0.0'
const PROXY_PORT = Number(process.env.OCUCLAW_PROXY_PORT || 8787)
const OPENCLAW_BASE_URL = (process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789').replace(/\/+$/, '')
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || 'openclaw'
const OPENCLAW_TRANSCRIPTION_MODEL = process.env.OPENCLAW_TRANSCRIPTION_MODEL || 'whisper-1'
const TRANSCRIPTION_BASE_URL = (process.env.OCUCLAW_TRANSCRIPTION_BASE_URL || process.env.OPENAI_BASE_URL || OPENCLAW_BASE_URL).replace(/\/+$/, '')
const TRANSCRIPTION_API_KEY = process.env.OCUCLAW_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY || ''
const TRANSCRIPTION_PATH = process.env.OCUCLAW_TRANSCRIPTION_PATH || '/audio/transcriptions'
const PROXY_KEY_PATH = join(homedir(), '.openclaw', 'ocuclaw-proxy-key')
const MAX_BODY_BYTES = 32 * 1024
const MAX_AUDIO_BYTES = Number(process.env.OCUCLAW_MAX_AUDIO_BYTES || 5 * 1024 * 1024)

let cachedToken = process.env.OPENCLAW_GATEWAY_TOKEN || ''
const PROXY_KEY = await loadProxyKey()

function jsonResponse(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ocuclaw-Key',
  })
  res.end(data)
}

function textResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

function hasValidProxyKey(req) {
  const provided = req.headers['x-ocuclaw-key']
  if (typeof provided !== 'string') return false

  const expectedBytes = Buffer.from(PROXY_KEY)
  const providedBytes = Buffer.from(provided)
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
}

async function readBody(req, maxBytes) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('Request body too large')
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

async function readJsonBody(req) {
  const body = await readBody(req, MAX_BODY_BYTES)
  if (!body.length) return {}
  return JSON.parse(body.toString('utf8'))
}

async function loadProxyKey() {
  if (process.env.OCUCLAW_PROXY_KEY?.trim()) return process.env.OCUCLAW_PROXY_KEY.trim()

  try {
    const key = (await readFile(PROXY_KEY_PATH, 'utf8')).trim()
    if (key) return key
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const key = randomBytes(12).toString('hex')
  await mkdir(join(homedir(), '.openclaw'), { recursive: true })
  await writeFile(PROXY_KEY_PATH, `${key}\n`, { mode: 0o600 })
  return key
}

async function loadGatewayToken() {
  if (cachedToken) return cachedToken

  const configPath = join(homedir(), '.openclaw', 'openclaw.json')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const token = config?.gateway?.auth?.token

  if (!token || typeof token !== 'string') {
    throw new Error(`No gateway.auth.token found in ${configPath}`)
  }

  cachedToken = token
  return token
}

async function openclawHealth() {
  const response = await fetch(`${OPENCLAW_BASE_URL}/health`)
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, ...body }
}

function resolveTranscriptionTarget() {
  const isExternal = TRANSCRIPTION_BASE_URL !== OPENCLAW_BASE_URL
  if (isExternal) {
    return { baseUrl: TRANSCRIPTION_BASE_URL, token: TRANSCRIPTION_API_KEY, requiresGatewayToken: false }
  }
  return { baseUrl: `${OPENCLAW_BASE_URL}/v1`, token: '', requiresGatewayToken: true }
}

async function openclawTranscribe(wavAudio) {
  const target = resolveTranscriptionTarget()
  const token = target.requiresGatewayToken ? await loadGatewayToken() : target.token
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const form = new FormData()
  form.append('model', OPENCLAW_TRANSCRIPTION_MODEL)
  form.append('file', new Blob([wavAudio], { type: 'audio/wav' }), 'prompt.wav')

  const path = TRANSCRIPTION_PATH.startsWith('/') ? TRANSCRIPTION_PATH : `/${TRANSCRIPTION_PATH}`
  const response = await fetch(`${target.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: form,
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = body?.error?.message || body?.error || `Transcription HTTP ${response.status}`
    throw new Error(String(message))
  }

  const text = body?.text || body?.transcript || body?.transcription
  if (typeof text !== 'string') throw new Error('Transcription response missing text')
  return text.trim()
}

async function openclawChat(prompt, sessionId) {
  const token = await loadGatewayToken()
  const payload = {
    model: OPENCLAW_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are Ocuclaw, a concise assistant replying to Even Realities G2 smart glasses. Keep responses short, readable at a glance, and under 300 characters unless asked otherwise.',
      },
      { role: 'user', content: prompt },
    ],
    stream: false,
  }
  if (typeof sessionId === 'string' && sessionId) payload.user = sessionId
  const response = await fetch(`${OPENCLAW_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = body?.error?.message || body?.error || `OpenClaw HTTP ${response.status}`
    throw new Error(String(message))
  }

  const text = body?.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('OpenClaw response missing choices[0].message.content')
  return text.trim()
}

function lanUrls() {
  const urls = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${PROXY_PORT}`)
    }
  }
  return urls
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'OPTIONS') {
      jsonResponse(res, 204, {})
      return
    }

    if (req.method === 'GET' && url.pathname === '/') {
      textResponse(res, 200, 'Ocuclaw proxy OK\n')
      return
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      try {
        const openclaw = await openclawHealth()
        jsonResponse(res, 200, { ok: true, authRequired: true, openclaw })
      } catch (error) {
        jsonResponse(res, 200, {
          ok: true,
          authRequired: true,
          openclaw: { ok: false, error: error instanceof Error ? error.message : String(error) },
        })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/transcribe') {
      if (!hasValidProxyKey(req)) {
        jsonResponse(res, 401, { ok: false, error: 'Invalid or missing Ocuclaw proxy key' })
        return
      }

      const wavAudio = await readBody(req, MAX_AUDIO_BYTES)
      if (wavAudio.length < 44) {
        jsonResponse(res, 400, { ok: false, error: 'Missing or invalid WAV audio' })
        return
      }

      const text = await openclawTranscribe(wavAudio)
      jsonResponse(res, 200, { ok: true, text })
      return
    }

    if (req.method === 'POST' && url.pathname === '/chat') {
      if (!hasValidProxyKey(req)) {
        jsonResponse(res, 401, { ok: false, error: 'Invalid or missing Ocuclaw proxy key' })
        return
      }

      const body = await readJsonBody(req)
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) {
        jsonResponse(res, 400, { ok: false, error: 'Missing prompt' })
        return
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

      const text = await openclawChat(prompt, sessionId)
      jsonResponse(res, 200, { ok: true, text })
      return
    }

    jsonResponse(res, 404, { ok: false, error: 'Not found' })
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`Ocuclaw proxy listening on http://${PROXY_HOST}:${PROXY_PORT}`)
  for (const url of lanUrls()) console.log(`LAN URL: ${url}`)
  console.log(`OpenClaw Gateway: ${OPENCLAW_BASE_URL}`)
  const t = resolveTranscriptionTarget()
  const authNote = t.requiresGatewayToken ? '(via OpenClaw gateway token)' : t.token ? '(api key)' : '(no auth)'
  const path = TRANSCRIPTION_PATH.startsWith('/') ? TRANSCRIPTION_PATH : `/${TRANSCRIPTION_PATH}`
  console.log(`Transcription endpoint: ${t.baseUrl}${path} (model: ${OPENCLAW_TRANSCRIPTION_MODEL}) ${authNote}`)
  console.log(`Proxy key: ${PROXY_KEY}`)
  console.log(`Proxy key file: ${PROXY_KEY_PATH}`)
  console.log('Enter this key in the Ocuclaw phone UI. Set OCUCLAW_PROXY_KEY to override it.')
})
