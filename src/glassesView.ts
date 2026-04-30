import type { ScrollSnapshot } from './chatHistory'

const MAX_GLASSES_CHARS = 1600
const LINE_WIDTH = 56

export type ReviewChoice = 'send' | 'edit' | 'cancel'

export type GlassesMode =
  | { kind: 'idle'; transientStatus: string | null }
  | { kind: 'recording'; seconds: number; blink: boolean }
  | { kind: 'review'; transcript: string; choice: ReviewChoice }
  | { kind: 'thinking'; prompt: string }

const SEPARATOR = '─'.repeat(LINE_WIDTH)

const REVIEW_ORDER: readonly ReviewChoice[] = ['send', 'edit', 'cancel'] as const
const REVIEW_LABELS: Record<ReviewChoice, string> = { send: 'Send', edit: 'Edit', cancel: 'Cancel' }

export const VIEWPORT_LINES = 5

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return '…' + text.slice(text.length - (max - 1))
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text
  return text + ' '.repeat(width - text.length)
}

function barLine(left: string, rightIcon: string): string {
  const maxLeft = LINE_WIDTH - 2
  const truncated = truncate(left, maxLeft)
  return `${pad(truncated, LINE_WIDTH - 1)}${rightIcon}`
}

function inputBar(mode: GlassesMode): string[] {
  switch (mode.kind) {
    case 'idle': {
      const text = mode.transientStatus ? `! ${mode.transientStatus}` : ''
      return [barLine(text, '○')]
    }
    case 'recording': {
      const icon = mode.blink ? '●' : '○'
      return [barLine(`${mode.seconds.toFixed(1)}s`, icon)]
    }
    case 'review': {
      const row = REVIEW_ORDER.map((c) => (c === mode.choice ? `[${REVIEW_LABELS[c]}]` : ` ${REVIEW_LABELS[c]} `)).join(' ')
      return [barLine(mode.transcript || '', '✓'), row]
    }
    case 'thinking':
      return [barLine(mode.prompt, '…')]
  }
}

function viewportLines(view: ScrollSnapshot | null): string[] {
  if (!view) return Array(VIEWPORT_LINES).fill('')
  const lines = view.lines.slice()
  while (lines.length < VIEWPORT_LINES) lines.push('')
  return lines
}

export function renderGlasses(view: ScrollSnapshot, mode: GlassesMode): string {
  const top = viewportLines(view)
  const bar = inputBar(mode)
  const out = [...top, SEPARATOR, ...bar]
  return out.join('\n').slice(0, MAX_GLASSES_CHARS)
}

export function cycleReviewChoice(current: ReviewChoice, direction: 'next' | 'prev'): ReviewChoice {
  const i = REVIEW_ORDER.indexOf(current)
  const delta = direction === 'next' ? 1 : -1
  const next = (i + delta + REVIEW_ORDER.length) % REVIEW_ORDER.length
  return REVIEW_ORDER[next]
}
