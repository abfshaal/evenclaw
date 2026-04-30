import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'

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

const STORAGE_KEY = 'ocuclaw.chat_history'
const MAX_ENTRIES = 40
const LINE_WIDTH = 56

export function wrapLine(text: string, width: number): string[] {
  if (!text) return ['']
  const out: string[] = []
  const paragraphs = text.split('\n')
  for (const para of paragraphs) {
    if (para.length === 0) {
      out.push('')
      continue
    }
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      if (!w) continue
      if ((line + w).length <= width) {
        line += w
        continue
      }
      if (line.trim().length > 0) {
        out.push(line.trimEnd())
        line = ''
      }
      if (w.length > width) {
        let rest = w
        while (rest.length > width) {
          out.push(rest.slice(0, width))
          rest = rest.slice(width)
        }
        line = rest
      } else {
        line = w.trimStart()
      }
    }
    if (line.trim().length > 0) out.push(line.trimEnd())
  }
  return out.length === 0 ? [''] : out
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
      const label = t.role === 'user' ? '▎You' : '▎Yoda'
      const body = wrapLine(t.text, LINE_WIDTH - 2).map((l) => `  ${l}`)
      out.push(label)
      out.push(...body)

      const next = this.turns[i + 1]
      if (!next) continue
      if (t.role === 'assistant' && next.role === 'user') {
        out.push('')
        out.push('━'.repeat(LINE_WIDTH))
        out.push('')
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

  scrollUp(viewportLines: number, step = 2): void {
    this.scroll(viewportLines, -step)
  }

  scrollDown(viewportLines: number, step = 2): void {
    this.scroll(viewportLines, step)
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
      const raw = await this.bridge.getLocalStorage(STORAGE_KEY)
      if (!raw) return
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
