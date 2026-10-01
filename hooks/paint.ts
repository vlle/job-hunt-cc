import type { Stage } from './hunt'

export type Cell = { ch: string; color?: string; dim?: boolean; bold?: boolean }

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const ACCENT = '#f5b942'
export const SILENCE = '#e3c35a'
export const STAGE_LOOK: Record<Stage, { glyph: string; color: string }> = {
  applied: { glyph: '○', color: '#6ea8fe' },
  screen: { glyph: '◐', color: '#4fd1c5' },
  interview: { glyph: '●', color: '#c084fc' },
  offer: { glyph: '★', color: '#4ade80' },
  rejected: { glyph: '✗', color: '#f87171' },
  closed: { glyph: '◌', color: '#7b8190' },
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function hexOf(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lightness - chroma / 2
  const [r, g, b] =
    h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
    : h < 180 ? [0, chroma, x]
    : h < 240 ? [0, x, chroma]
    : h < 300 ? [x, 0, chroma]
    : [chroma, 0, x]
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0')

  return `#${byte(r)}${byte(g)}${byte(b)}`
}

export function fitColorOf(fit: number): string {
  return hexOf((Math.min(100, Math.max(0, fit)) / 100) * 130, 0.7, 0.55)
}

export function fitBarOf(fit: number, width: number): Cell[] {
  const filled = (Math.min(100, Math.max(0, fit)) / 100) * width
  const full = Math.floor(filled)
  const partial = Math.floor((filled - full) * 8)
  const color = fitColorOf(fit)
  const cells: Cell[] = []

  for (let i = 0; i < width; i++) {
    if (i < full) {
      cells.push({ ch: '█', color })
    } else if (i === full && partial > 0) {
      cells.push({ ch: EIGHTHS[partial] ?? ' ', color })
    } else {
      cells.push({ ch: '·', dim: true })
    }
  }

  return cells
}

export function fitOf(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }
  const chars = [...text]

  return chars.length <= width ? text.padEnd(width) : `${chars.slice(0, width - 1).join('')}…`
}

export function agoOf(ms: number | null, now: number): string {
  if (ms === null) {
    return 'never'
  }
  const passed = Math.max(0, now - ms)

  return passed < MINUTE_MS ? 'just now'
    : passed < HOUR_MS ? `${Math.floor(passed / MINUTE_MS)}m ago`
    : passed < DAY_MS ? `${Math.floor(passed / HOUR_MS)}h ago`
    : `${Math.floor(passed / DAY_MS)}d ago`
}

export function minutesOf(ms: number): string {
  return `${Math.max(0, Math.floor(ms / MINUTE_MS))} min`
}

export function dayOf(ms: number): string {
  const date = new Date(ms)
  const two = (v: number) => String(v).padStart(2, '0')

  return `${two(date.getUTCDate())}.${two(date.getUTCMonth() + 1)}`
}
