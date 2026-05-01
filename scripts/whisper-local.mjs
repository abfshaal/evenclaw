#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const WHISPER_DIR = process.env.GLASSES_CLAW_WHISPER_DIR || process.env.OCUCLAW_WHISPER_DIR || join(homedir(), '.glasses-claw', 'whisper.cpp')
const MODEL = process.env.GLASSES_CLAW_WHISPER_MODEL || process.env.OCUCLAW_WHISPER_MODEL || 'base.en'
const PORT = Number(process.env.GLASSES_CLAW_WHISPER_PORT || process.env.OCUCLAW_WHISPER_PORT || 9001)
const HOST = process.env.GLASSES_CLAW_WHISPER_HOST || process.env.OCUCLAW_WHISPER_HOST || '127.0.0.1'
const REPO = 'https://github.com/ggml-org/whisper.cpp'

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}`)
  }
}

function ensureRepo() {
  if (existsSync(join(WHISPER_DIR, '.git'))) {
    console.log(`[whisper] using existing repo at ${WHISPER_DIR}`)
    return
  }
  mkdirSync(WHISPER_DIR.replace(/\/[^/]+$/, ''), { recursive: true })
  console.log(`[whisper] cloning ${REPO} into ${WHISPER_DIR}`)
  run('git', ['clone', '--depth', '1', REPO, WHISPER_DIR])
}

function ensureBuild() {
  const serverBin = join(WHISPER_DIR, 'build', 'bin', 'whisper-server')
  if (existsSync(serverBin)) {
    console.log(`[whisper] build already present at ${serverBin}`)
    return serverBin
  }
  console.log('[whisper] building (cmake + make)...')
  run('cmake', ['-B', 'build'], { cwd: WHISPER_DIR })
  run('cmake', ['--build', 'build', '-j', '--config', 'Release'], { cwd: WHISPER_DIR })
  if (!existsSync(serverBin)) {
    throw new Error(`build finished but ${serverBin} not found`)
  }
  return serverBin
}

function ensureModel() {
  const modelPath = join(WHISPER_DIR, 'models', `ggml-${MODEL}.bin`)
  if (existsSync(modelPath)) {
    console.log(`[whisper] model present: ${modelPath}`)
    return modelPath
  }
  console.log(`[whisper] downloading model ${MODEL}...`)
  run('bash', [join('models', 'download-ggml-model.sh'), MODEL], { cwd: WHISPER_DIR })
  if (!existsSync(modelPath)) {
    throw new Error(`download finished but ${modelPath} not found`)
  }
  return modelPath
}

function startServer(serverBin, modelPath) {
  console.log(`[whisper] starting server on ${HOST}:${PORT} with model ${MODEL}`)
  console.log(`[whisper] OpenAI-compatible endpoint: http://${HOST}:${PORT}/v1/audio/transcriptions`)
  console.log('[whisper] set in .env:')
  console.log(`  GLASSES_CLAW_TRANSCRIPTION_BASE_URL=http://${HOST}:${PORT}/v1`)
  console.log(`  OPENCLAW_TRANSCRIPTION_MODEL=whisper-1`)
  const child = spawn(
    serverBin,
    ['-m', modelPath, '--host', HOST, '--port', String(PORT), '--convert'],
    { stdio: 'inherit', cwd: WHISPER_DIR },
  )
  child.on('exit', (code, signal) => {
    console.log(`[whisper] server exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    process.exit(code ?? 1)
  })
  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
}

try {
  ensureRepo()
  const serverBin = ensureBuild()
  const modelPath = ensureModel()
  startServer(serverBin, modelPath)
} catch (error) {
  console.error('[whisper] error:', error.message)
  process.exit(1)
}
