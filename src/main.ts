import './styles.css'
import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { checkProxyHealth, sendPrompt, transcribeVoicePrompt } from './openclawClient'
import { inferDefaultProxyUrl, loadProxyKey, loadProxyUrl, loadRuntimeConfig, saveProxyKey, saveProxyUrl } from './config'
import { ChatHistory } from './chatHistory'
import { cycleReviewChoice, renderGlasses, VIEWPORT_LINES, type GlassesMode, type ReviewChoice } from './glassesView'

const GLASSES_TEXT_ID = 1
const GLASSES_TEXT_NAME = 'ocuclaw-main'
const VOICE_SAMPLE_RATE = 16_000
const VOICE_BYTES_PER_SAMPLE = 2
const MAX_VOICE_BYTES = 3 * 1024 * 1024

type AppMode = 'idle' | 'recording' | 'review' | 'thinking'

type AppState = {
  bridgeStatus: string
  proxyStatus: string
  proxyUrl: string
  proxyKey: string
  prompt: string
  mode: AppMode
  reviewChoice: ReviewChoice
  pendingTranscript: string
  transientStatus: string | null
  voiceBytes: number
  recordingStartedAt: number
  busy: boolean
}

const state: AppState = {
  bridgeStatus: 'Waiting for Even App bridge...',
  proxyStatus: 'Not checked',
  proxyUrl: inferDefaultProxyUrl(),
  proxyKey: '',
  prompt: '',
  mode: 'idle',
  reviewChoice: 'send',
  pendingTranscript: '',
  transientStatus: null,
  voiceBytes: 0,
  recordingStartedAt: 0,
  busy: false,
}

const history = new ChatHistory()

let bridge: EvenAppBridge | null = null
let glassesReady = false
let eventUnsubscribe: (() => void) | undefined
let voiceChunks: Uint8Array[] = []
let lastVoiceUiUpdate = 0
let voiceTransitioning = false
let recordingTickerId: number | null = null
let blinkOn = true

function currentGlassesMode(): GlassesMode {
  switch (state.mode) {
    case 'recording': {
      const seconds = (Date.now() - state.recordingStartedAt) / 1000
      return { kind: 'recording', seconds, blink: blinkOn }
    }
    case 'review':
      return { kind: 'review', transcript: state.pendingTranscript, choice: state.reviewChoice }
    case 'thinking':
      return { kind: 'thinking', prompt: state.pendingTranscript || state.prompt }
    case 'idle':
    default:
      return { kind: 'idle', transientStatus: state.transientStatus }
  }
}

function glassesText(): string {
  return renderGlasses(history.viewport(VIEWPORT_LINES), currentGlassesMode())
}

function startRecordingTicker(): void {
  if (recordingTickerId !== null) return
  blinkOn = true
  recordingTickerId = window.setInterval(() => {
    blinkOn = !blinkOn
    void updateGlasses()
  }, 500)
}

function stopRecordingTicker(): void {
  if (recordingTickerId !== null) {
    window.clearInterval(recordingTickerId)
    recordingTickerId = null
  }
  blinkOn = true
}

async function updateGlasses(): Promise<void> {
  if (!bridge || !glassesReady) return

  const content = glassesText()
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: GLASSES_TEXT_ID,
      containerName: GLASSES_TEXT_NAME,
      contentOffset: 0,
      contentLength: content.length,
      content,
    }),
  )
}

function getEventType(event: EvenHubEvent): number | undefined {
  if (event.sysEvent) return event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT
  if (event.listEvent) return event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT
  if (event.textEvent) return event.textEvent.eventType
  const loose = event.jsonData?.eventType
  return typeof loose === 'number' ? loose : undefined
}

function renderPhoneUi(): void {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) throw new Error('Missing #app')

  app.innerHTML = `
    <section class="panel">
      <div class="card">
        <h1>OCUCLAW</h1>
        <p class="status"><strong>Glasses:</strong> <span id="bridge-status"></span></p>
        <p class="status"><strong>Proxy:</strong> <span id="proxy-status"></span></p>
        <p class="status"><strong>Mode:</strong> <span id="mode-status"></span></p>
        <p class="status"><strong>Status:</strong> <span id="transient-status"></span></p>

        <label for="proxy-url">Ocuclaw proxy URL</label>
        <input id="proxy-url" autocomplete="off" spellcheck="false" />
        <label for="proxy-key">Proxy key</label>
        <input id="proxy-key" autocomplete="off" spellcheck="false" placeholder="Printed by npm run proxy" />
        <button id="save-proxy" type="button">Save proxy settings</button>
        <button id="check-proxy" type="button">Check proxy</button>

        <label for="prompt">Debug prompt (typed)</label>
        <textarea id="prompt" spellcheck="true"></textarea>
        <button id="send-typed" type="button">Send typed prompt as user turn</button>
        <button id="start-voice" type="button">Start recording (debug)</button>
        <button id="stop-voice" type="button">Stop recording (debug)</button>
        <button id="clear-history" type="button">Clear chat history</button>

        <h2>Chat log</h2>
        <div class="chat-log" id="chat-log"></div>
        <p class="hint">Phone and Mac must be on same Wi-Fi. Proxy on Mac port 8787. Glasses gestures: double-tap = record, scroll up/down = paginate or cycle review choices, single tap = confirm review.</p>
      </div>
    </section>
  `

  bindPhoneUi()
  syncPhoneUi()
}

function bindPhoneUi(): void {
  const proxyInput = document.querySelector<HTMLInputElement>('#proxy-url')
  const proxyKeyInput = document.querySelector<HTMLInputElement>('#proxy-key')
  const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt')
  const saveProxyButton = document.querySelector<HTMLButtonElement>('#save-proxy')
  const checkProxyButton = document.querySelector<HTMLButtonElement>('#check-proxy')
  const sendTypedButton = document.querySelector<HTMLButtonElement>('#send-typed')
  const startVoiceButton = document.querySelector<HTMLButtonElement>('#start-voice')
  const stopVoiceButton = document.querySelector<HTMLButtonElement>('#stop-voice')
  const clearHistoryButton = document.querySelector<HTMLButtonElement>('#clear-history')

  if (!proxyInput || !proxyKeyInput || !promptInput || !saveProxyButton || !checkProxyButton || !sendTypedButton || !startVoiceButton || !stopVoiceButton || !clearHistoryButton) {
    throw new Error('Missing UI elements')
  }

  promptInput.addEventListener('input', () => {
    state.prompt = promptInput.value
  })

  proxyInput.addEventListener('input', () => {
    state.proxyUrl = proxyInput.value
  })

  proxyKeyInput.addEventListener('input', () => {
    state.proxyKey = proxyKeyInput.value
  })

  saveProxyButton.addEventListener('click', () => {
    state.proxyUrl = saveProxyUrl(proxyInput.value)
    state.proxyKey = saveProxyKey(proxyKeyInput.value)
    state.proxyStatus = `Saved ${state.proxyUrl}`
    syncPhoneUi()
    void updateGlasses()
  })

  checkProxyButton.addEventListener('click', () => {
    state.proxyUrl = saveProxyUrl(proxyInput.value)
    state.proxyKey = saveProxyKey(proxyKeyInput.value)
    void checkProxy()
  })

  sendTypedButton.addEventListener('click', () => {
    state.proxyUrl = saveProxyUrl(proxyInput.value)
    state.proxyKey = saveProxyKey(proxyKeyInput.value)
    const text = promptInput.value.trim()
    if (!text) return
    state.pendingTranscript = text
    state.reviewChoice = 'send'
    void executeReviewSend()
    promptInput.value = ''
    state.prompt = ''
  })

  startVoiceButton.addEventListener('click', () => {
    state.proxyUrl = saveProxyUrl(proxyInput.value)
    state.proxyKey = saveProxyKey(proxyKeyInput.value)
    void startRecording()
  })

  stopVoiceButton.addEventListener('click', () => {
    void stopRecordingAndTranscribe()
  })

  clearHistoryButton.addEventListener('click', () => {
    history.clear()
    syncPhoneUi()
    void updateGlasses()
  })
}

function renderChatLog(): string {
  const turns = history.all()
  if (turns.length === 0) return '<em>(empty)</em>'
  return turns
    .map((t) => {
      const label = t.role === 'user' ? 'You' : 'Yoda'
      const escaped = t.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<div class="chat-turn chat-${t.role}"><strong>${label}:</strong> ${escaped}</div>`
    })
    .join('')
}

function syncPhoneUi(): void {
  const bridgeStatus = document.querySelector<HTMLSpanElement>('#bridge-status')
  const proxyStatus = document.querySelector<HTMLSpanElement>('#proxy-status')
  const modeStatus = document.querySelector<HTMLSpanElement>('#mode-status')
  const transientStatus = document.querySelector<HTMLSpanElement>('#transient-status')
  const proxyInput = document.querySelector<HTMLInputElement>('#proxy-url')
  const proxyKeyInput = document.querySelector<HTMLInputElement>('#proxy-key')
  const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt')
  const chatLog = document.querySelector<HTMLDivElement>('#chat-log')
  const buttons = document.querySelectorAll<HTMLButtonElement>('button')
  const sendTypedButton = document.querySelector<HTMLButtonElement>('#send-typed')
  const startVoiceButton = document.querySelector<HTMLButtonElement>('#start-voice')
  const stopVoiceButton = document.querySelector<HTMLButtonElement>('#stop-voice')

  if (bridgeStatus) bridgeStatus.textContent = state.bridgeStatus
  if (proxyStatus) proxyStatus.textContent = state.proxyStatus
  if (modeStatus) modeStatus.textContent = `${state.mode}${state.mode === 'review' ? ` (highlight: ${state.reviewChoice})` : ''}`
  if (transientStatus) transientStatus.textContent = state.transientStatus || ''
  if (proxyInput && proxyInput.value !== state.proxyUrl) proxyInput.value = state.proxyUrl
  if (proxyKeyInput && proxyKeyInput.value !== state.proxyKey) proxyKeyInput.value = state.proxyKey
  if (promptInput && promptInput.value !== state.prompt) promptInput.value = state.prompt
  if (chatLog) chatLog.innerHTML = renderChatLog()

  buttons.forEach((button) => {
    button.disabled = state.busy
  })
  if (sendTypedButton) sendTypedButton.disabled = state.busy || state.mode !== 'idle'
  if (startVoiceButton) startVoiceButton.disabled = state.busy || state.mode === 'recording'
  if (stopVoiceButton) stopVoiceButton.disabled = state.mode !== 'recording'

  const saveProxyButton = document.querySelector<HTMLButtonElement>('#save-proxy')
  const checkProxyButton = document.querySelector<HTMLButtonElement>('#check-proxy')
  const clearHistoryButton = document.querySelector<HTMLButtonElement>('#clear-history')
  if (saveProxyButton) saveProxyButton.disabled = state.busy || state.mode !== 'idle'
  if (checkProxyButton) checkProxyButton.disabled = state.busy || state.mode !== 'idle'
  if (clearHistoryButton) clearHistoryButton.disabled = state.busy || state.mode !== 'idle'
}

function setMode(mode: AppMode): void {
  state.mode = mode
  if (mode !== 'idle') state.transientStatus = null
  if (mode === 'recording') startRecordingTicker()
  else stopRecordingTicker()
  syncPhoneUi()
  void updateGlasses()
}

function setTransient(message: string | null): void {
  state.transientStatus = message
  syncPhoneUi()
  void updateGlasses()
}

async function checkProxy(): Promise<void> {
  state.proxyStatus = 'Checking...'
  syncPhoneUi()
  await updateGlasses()

  try {
    const health = await checkProxyHealth(state.proxyUrl, state.proxyKey)
    state.proxyStatus = health.openclaw?.ok ? 'Connected to OpenClaw' : `Proxy OK, OpenClaw unavailable: ${health.openclaw?.error || 'unknown'}`
  } catch (error) {
    state.proxyStatus = `Proxy unavailable: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    syncPhoneUi()
    await updateGlasses()
  }
}

async function startRecording(): Promise<void> {
  if (!bridge || !glassesReady) {
    setTransient('mic unavailable; glasses UI not ready')
    return
  }
  if (state.mode !== 'idle' && state.mode !== 'review') return
  if (voiceTransitioning) return

  voiceTransitioning = true
  voiceChunks = []
  state.voiceBytes = 0
  state.recordingStartedAt = Date.now()
  setMode('recording')

  try {
    const ok = await bridge.audioControl(true)
    if (!ok) throw new Error('audioControl(true) returned false')
  } catch (error) {
    voiceChunks = []
    state.voiceBytes = 0
    setMode('idle')
    setTransient(`mic open failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    voiceTransitioning = false
    await updateGlasses()
  }
}

async function stopRecordingAndTranscribe(): Promise<void> {
  if (!bridge || state.mode !== 'recording' || voiceTransitioning) return

  voiceTransitioning = true
  try {
    await bridge.audioControl(false)
  } catch (error) {
    console.warn('audioControl(false) failed', error)
  }

  const chunks = voiceChunks
  const totalBytes = state.voiceBytes
  voiceChunks = []
  state.voiceBytes = 0

  if (totalBytes < VOICE_SAMPLE_RATE * VOICE_BYTES_PER_SAMPLE) {
    voiceTransitioning = false
    setMode('idle')
    setTransient('too short; double-tap to retry')
    return
  }

  state.busy = true
  syncPhoneUi()

  try {
    const transcript = await transcribeVoicePrompt(state.proxyUrl, state.proxyKey, pcmChunksToWav(chunks, totalBytes))
    if (!transcript) throw new Error('no speech detected')
    state.pendingTranscript = state.pendingTranscript ? `${state.pendingTranscript} ${transcript}` : transcript
    state.reviewChoice = 'send'
    state.busy = false
    setMode('review')
    voiceTransitioning = false
  } catch (error) {
    state.busy = false
    state.pendingTranscript = ''
    setMode('idle')
    voiceTransitioning = false
    setTransient(`transcribe failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function executeReviewSend(): Promise<void> {
  const prompt = state.pendingTranscript.trim()
  if (!prompt) {
    state.pendingTranscript = ''
    setMode('idle')
    return
  }

  state.busy = true
  setMode('thinking')

  try {
    const reply = await sendPrompt(state.proxyUrl, state.proxyKey, prompt)
    history.append({ role: 'user', text: prompt, ts: Date.now() })
    history.append({ role: 'assistant', text: reply, ts: Date.now() })
    state.proxyStatus = 'Connected to OpenClaw'
    state.busy = false
    state.pendingTranscript = ''
    setMode('idle')
  } catch (error) {
    state.busy = false
    state.pendingTranscript = ''
    setMode('idle')
    setTransient(`send failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function executeReviewCancel(): void {
  state.pendingTranscript = ''
  setMode('idle')
}

async function executeReviewChoice(): Promise<void> {
  switch (state.reviewChoice) {
    case 'send':
      await executeReviewSend()
      return
    case 'edit':
      await startRecording()
      return
    case 'cancel':
      executeReviewCancel()
  }
}

function appendVoiceChunk(pcm: Uint8Array): void {
  if (state.mode !== 'recording' || voiceTransitioning) return

  if (state.voiceBytes + pcm.byteLength > MAX_VOICE_BYTES) {
    void stopRecordingAndTranscribe()
    return
  }

  voiceChunks.push(new Uint8Array(pcm))
  state.voiceBytes += pcm.byteLength

  const now = Date.now()
  if (now - lastVoiceUiUpdate > 500) {
    lastVoiceUiUpdate = now
    syncPhoneUi()
    void updateGlasses()
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
}

function pcmChunksToWav(chunks: Uint8Array[], totalBytes: number): Blob {
  const wav = new ArrayBuffer(44 + totalBytes)
  const view = new DataView(wav)
  const channels = 1
  const byteRate = VOICE_SAMPLE_RATE * channels * VOICE_BYTES_PER_SAMPLE
  const blockAlign = channels * VOICE_BYTES_PER_SAMPLE

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + totalBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, VOICE_SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, VOICE_BYTES_PER_SAMPLE * 8, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, totalBytes, true)

  const output = new Uint8Array(wav)
  let offset = 44
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new Blob([wav], { type: 'audio/wav' })
}

async function initGlassesUi(appBridge: EvenAppBridge): Promise<void> {
  const result = await appBridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          containerID: GLASSES_TEXT_ID,
          containerName: GLASSES_TEXT_NAME,
          content: glassesText(),
          isEventCapture: 1,
        }),
      ],
    }),
  )

  glassesReady = result === StartUpPageCreateResult.success
  state.bridgeStatus = glassesReady ? 'Connected; glasses UI ready' : `Glasses UI failed: ${result}`
  syncPhoneUi()
}

function handleEvenHubEvent(event: EvenHubEvent): void {
  if (event.audioEvent?.audioPcm) {
    appendVoiceChunk(event.audioEvent.audioPcm)
    return
  }

  const eventType = getEventType(event)

  switch (state.mode) {
    case 'idle':
      if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        void startRecording()
      } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
        history.scrollUp(VIEWPORT_LINES)
        void updateGlasses()
      } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        history.scrollDown(VIEWPORT_LINES)
        void updateGlasses()
      }
      return

    case 'recording':
      if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        void stopRecordingAndTranscribe()
      }
      return

    case 'review':
      if (eventType === OsEventTypeList.CLICK_EVENT) {
        void executeReviewChoice()
      } else if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
        state.reviewChoice = cycleReviewChoice(state.reviewChoice, 'prev')
        void updateGlasses()
      } else if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        state.reviewChoice = cycleReviewChoice(state.reviewChoice, 'next')
        void updateGlasses()
      }
      return

    case 'thinking':
      return
  }
}

function bridgeTimeout(ms: number): Promise<null> {
  return new Promise((resolve) => window.setTimeout(() => resolve(null), ms))
}

async function connectEvenBridge(): Promise<void> {
  try {
    bridge = await Promise.race([waitForEvenAppBridge(), bridgeTimeout(2500)])
    if (!bridge) {
      state.bridgeStatus = 'Even App bridge not detected; phone-only debug mode'
      syncPhoneUi()
      return
    }

    eventUnsubscribe = bridge.onEvenHubEvent(handleEvenHubEvent)
    history.setBridge(bridge)
    await history.load()
    window.addEventListener('beforeunload', () => {
      if (state.mode === 'recording') void bridge?.audioControl(false)
      stopRecordingTicker()
      eventUnsubscribe?.()
    })
    await initGlassesUi(bridge)
    void updateGlasses()
  } catch (error) {
    state.bridgeStatus = `Bridge error: ${error instanceof Error ? error.message : String(error)}`
    syncPhoneUi()
  }
}

async function bootstrap(): Promise<void> {
  const runtimeConfig = await loadRuntimeConfig()
  state.proxyUrl = loadProxyUrl(runtimeConfig.proxyUrl)
  state.proxyKey = loadProxyKey(runtimeConfig.proxyKey)
  renderPhoneUi()
  await connectEvenBridge()
  await checkProxy()
}

void bootstrap()
