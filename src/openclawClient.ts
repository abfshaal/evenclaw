export type OcuclawHealth = {
  ok: boolean
  authRequired?: boolean
  openclaw?: {
    ok: boolean
    status?: string
    error?: string
  }
}

export type OcuclawChatResponse = {
  ok: boolean
  text: string
}

export type OcuclawTranscribeResponse = {
  ok: boolean
  text: string
}

function proxyHeaders(proxyKey: string): HeadersInit {
  return proxyKey ? { 'X-Ocuclaw-Key': proxyKey } : {}
}

export async function checkProxyHealth(proxyUrl: string, proxyKey: string, signal?: AbortSignal): Promise<OcuclawHealth> {
  const response = await fetch(`${proxyUrl}/health`, { headers: proxyHeaders(proxyKey), signal })
  if (!response.ok) throw new Error(`Proxy health failed: HTTP ${response.status}`)
  return (await response.json()) as OcuclawHealth
}

export async function sendPrompt(proxyUrl: string, proxyKey: string, prompt: string, sessionId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${proxyUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...proxyHeaders(proxyKey) },
    body: JSON.stringify({ prompt, sessionId }),
    signal,
  })

  const body = (await response.json().catch(() => ({}))) as Partial<OcuclawChatResponse> & {
    error?: string
  }

  if (!response.ok || !body.ok) {
    throw new Error(body.error || `OpenClaw chat failed: HTTP ${response.status}`)
  }

  return body.text || '(empty response)'
}

export async function transcribeVoicePrompt(proxyUrl: string, proxyKey: string, wavAudio: Blob, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${proxyUrl}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', ...proxyHeaders(proxyKey) },
    body: wavAudio,
    signal,
  })

  const body = (await response.json().catch(() => ({}))) as Partial<OcuclawTranscribeResponse> & {
    error?: string
  }

  if (!response.ok || !body.ok) {
    throw new Error(body.error || `OpenClaw transcription failed: HTTP ${response.status}`)
  }

  return body.text?.trim() || ''
}
