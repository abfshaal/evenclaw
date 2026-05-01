import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { getTextWidth } from '@evenrealities/pretext'

export type Turn = {
  role: 'user' | 'assistant'
  text: string
  ts: number
}

export type ScrollSnapshot = {
  lines: string[]
  totalLines: number
  scrollTop: number
  viewportLines: number
  atBottom: boolean
  atTop: boolean
  empty: boolean
}

const STORAGE_KEY = 'glasses-claw.chat_history'
const LEGACY_STORAGE_KEY = 'ocuclaw.chat_history'
const MAX_ENTRIES = 40
export const LINE_PX = 576
const SEPARATOR_LINE = '─'.repeat(48)

export function wrapToPx(text: string, maxPx: number): string[] {
  if (!text) return ['']
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para.length === 0) {
      out.push('')
      continue
    }
    out.push(...wrapParaPx(para, maxPx))
  }
  return out.length === 0 ? [''] : out
}

function wrapParaInline(para: string, firstPx: number, restPx: number): string[] {
  if (!para) return ['']
  const words = para.split(/(\s+)/).filter((w) => w.length > 0)
  const out: string[] = []
  let line = ''
  let budget = firstPx
  for (const w of words) {
    const candidate = line + w
    if (getTextWidth(candidate) <= budget) {
      line = candidate
      continue
    }
    if (line.trim().length > 0) {
      out.push(line.trimEnd())
      line = ''
      budget = restPx
    }
    if (getTextWidth(w) > budget) {
      let rest = w
      while (getTextWidth(rest) > budget) {
        let cut = rest.length
        while (cut > 0 && getTextWidth(rest.slice(0, cut)) > budget) cut -= 1
        if (cut <= 0) cut = 1
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
        budget = restPx
      }
      line = rest
    } else {
      line = w.trimStart()
    }
  }
  if (line.trim().length > 0) out.push(line.trimEnd())
  return out.length === 0 ? [''] : out
}

function wrapParaPx(para: string, maxPx: number): string[] {
  const words = para.split(/(\s+)/).filter((w) => w.length > 0)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const candidate = line + w
    if (getTextWidth(candidate) <= maxPx) {
      line = candidate
      continue
    }
    if (line.trim().length > 0) {
      out.push(line.trimEnd())
      line = ''
    }
    if (getTextWidth(w) > maxPx) {
      let rest = w
      while (getTextWidth(rest) > maxPx) {
        let cut = rest.length
        while (cut > 0 && getTextWidth(rest.slice(0, cut)) > maxPx) cut -= 1
        if (cut <= 0) cut = 1
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    } else {
      line = w.trimStart()
    }
  }
  if (line.trim().length > 0) out.push(line.trimEnd())
  return out
}

export class ChatHistory {
  private turns: Turn[] = []
  private scrollTop = 0
  private stickToBottom = true
  private pinToLatestQuestion = false
  private bridge: EvenAppBridge | null = null

  setBridge(bridge: EvenAppBridge | null): void {
    this.bridge = bridge
  }

  all(): Turn[] {
    return this.turns.slice()
  }

  append(turn: Turn): void {
    this.turns.push(turn)
    if (this.turns.length > MAX_ENTRIES) {
      this.turns.splice(0, this.turns.length - MAX_ENTRIES)
    }
    if (turn.role === 'assistant') {
      this.pinToLatestQuestion = true
      this.stickToBottom = false
    } else {
      this.stickToBottom = true
      this.pinToLatestQuestion = false
    }
    void this.save()
  }

  clear(): void {
    this.turns = []
    this.scrollTop = 0
    this.stickToBottom = true
    this.pinToLatestQuestion = false
    void this.save()
  }

  private renderWithOffsets(): { lines: string[]; turnStarts: number[] } {
    const out: string[] = []
    const turnStarts: number[] = []
    for (let i = 0; i < this.turns.length; i += 1) {
      const t = this.turns[i]
      turnStarts.push(out.length)
      const prefix = t.role === 'user' ? 'You> ' : 'Yoda> '
      const prefixPx = getTextWidth(prefix)
      const firstLineBudget = LINE_PX - prefixPx
      const paragraphs = t.text.split('\n')
      const first = paragraphs.shift() ?? ''
      const firstWrapped = wrapParaInline(first, firstLineBudget, LINE_PX)
      out.push(prefix + (firstWrapped[0] ?? ''))
      for (let j = 1; j < firstWrapped.length; j += 1) out.push(firstWrapped[j])
      for (const para of paragraphs) {
        if (para.length === 0) {
          out.push('')
          continue
        }
        out.push(...wrapToPx(para, LINE_PX))
      }

      const next = this.turns[i + 1]
      if (next && t.role === 'assistant' && next.role === 'user') {
        out.push(SEPARATOR_LINE)
      }
    }
    return { lines: out, turnStarts }
  }

  private renderLines(): string[] {
    return this.renderWithOffsets().lines
  }

  private latestUserTurnLine(): number | null {
    const { turnStarts } = this.renderWithOffsets()
    for (let i = this.turns.length - 1; i >= 0; i -= 1) {
      if (this.turns[i].role === 'user') return turnStarts[i]
    }
    return null
  }

  private resolvedScrollTop(viewportLines: number): number {
    const lines = this.renderLines()
    const max = Math.max(0, lines.length - viewportLines)
    if (this.stickToBottom) return max
    if (this.pinToLatestQuestion) {
      const pinned = this.latestUserTurnLine()
      if (pinned !== null) return Math.min(pinned, max)
    }
    return Math.min(this.scrollTop, max)
  }

  scroll(viewportLines: number, deltaLines: number): void {
    const lines = this.renderLines()
    const max = Math.max(0, lines.length - viewportLines)
    const current = this.resolvedScrollTop(viewportLines)
    const next = Math.min(max, Math.max(0, current + deltaLines))
    this.scrollTop = next
    this.stickToBottom = next >= max
    this.pinToLatestQuestion = false
  }

  scrollUp(viewportLines: number, step?: number): void {
    this.scroll(viewportLines, -(step ?? Math.max(1, viewportLines - 1)))
  }

  scrollDown(viewportLines: number, step?: number): void {
    this.scroll(viewportLines, step ?? Math.max(1, viewportLines - 1))
  }

  viewport(viewportLines: number): ScrollSnapshot {
    const lines = this.renderLines()
    const total = lines.length
    const max = Math.max(0, total - viewportLines)
    const top = this.resolvedScrollTop(viewportLines)
    const window = lines.slice(top, top + viewportLines)
    while (window.length < viewportLines) window.push('')
    return {
      lines: window,
      totalLines: total,
      scrollTop: top,
      viewportLines,
      atBottom: top >= max,
      atTop: top === 0,
      empty: this.turns.length === 0,
    }
  }

  async load(): Promise<void> {
    if (!this.bridge) return
    try {
      let raw = await this.bridge.getLocalStorage(STORAGE_KEY)
      if (!raw) {
        raw = await this.bridge.getLocalStorage(LEGACY_STORAGE_KEY)
        if (!raw) return
      }
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      const valid = parsed.filter((t): t is Turn =>
        Boolean(t) &&
        typeof t === 'object' &&
        (t as Turn).role !== undefined &&
        ((t as Turn).role === 'user' || (t as Turn).role === 'assistant') &&
        typeof (t as Turn).text === 'string' &&
        typeof (t as Turn).ts === 'number',
      )
      this.turns = valid.slice(-MAX_ENTRIES)
      this.stickToBottom = true
      this.scrollTop = 0
    } catch (error) {
      console.warn('ChatHistory.load failed', error)
    }
  }

  async save(): Promise<void> {
    if (!this.bridge) return
    try {
      await this.bridge.setLocalStorage(STORAGE_KEY, JSON.stringify(this.turns))
    } catch (error) {
      console.warn('ChatHistory.save failed', error)
    }
  }
}
