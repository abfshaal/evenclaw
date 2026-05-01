import { pxTruncate, getTextWidth } from '@evenrealities/pretext'
import { LINE_PX, type ScrollSnapshot } from './chatHistory'

const MAX_GLASSES_CHARS = 1600
const MAX_LINES = 10

export type ReviewChoice = 'send' | 'edit' | 'cancel'

export type GlassesMode =
  | { kind: 'idle'; transientStatus: string | null }
  | { kind: 'recording'; seconds: number; blink: boolean }
  | { kind: 'review'; transcript: string; choice: ReviewChoice }
  | { kind: 'thinking'; prompt: string }

const REVIEW_ORDER: readonly ReviewChoice[] = ['send', 'edit', 'cancel'] as const
const REVIEW_LABELS: Record<ReviewChoice, string> = { send: 'Send', edit: 'Edit', cancel: 'Cancel' }

function pad(text: string, widthPx: number): string {
  const cur = getTextWidth(text)
  if (cur >= widthPx) return text
  const spacePx = getTextWidth(' ')
  const n = Math.max(0, Math.floor((widthPx - cur) / spacePx))
  return text + ' '.repeat(n)
}

function barLine(left: string, rightIcon: string): string {
  const iconPx = getTextWidth(rightIcon) + getTextWidth(' ')
  const leftBudget = LINE_PX - iconPx
  const truncated = pxTruncate(left, leftBudget)
  return `${pad(truncated, leftBudget)}${rightIcon}`
}

function inputBarLines(mode: GlassesMode): string[] {
  switch (mode.kind) {
    case 'idle': {
      if (!mode.transientStatus) return []
      return [barLine(`! ${mode.transientStatus}`, '○')]
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

export function viewportLinesFor(mode: GlassesMode): number {
  return Math.max(1, MAX_LINES - inputBarLines(mode).length)
}

function fillViewport(view: ScrollSnapshot | null, count: number): string[] {
  if (!view) return Array(count).fill('')
  const lines = view.lines.slice(0, count)
  while (lines.length < count) lines.push('')
  return lines
}

export function renderGlasses(view: ScrollSnapshot, mode: GlassesMode): string {
  const bar = inputBarLines(mode)
  const top = fillViewport(view, MAX_LINES - bar.length)
  return [...top, ...bar].join('\n').slice(0, MAX_GLASSES_CHARS)
}

export function cycleReviewChoice(current: ReviewChoice, direction: 'next' | 'prev'): ReviewChoice {
  const i = REVIEW_ORDER.indexOf(current)
  const delta = direction === 'next' ? 1 : -1
  const next = (i + delta + REVIEW_ORDER.length) % REVIEW_ORDER.length
  return REVIEW_ORDER[next]
}
