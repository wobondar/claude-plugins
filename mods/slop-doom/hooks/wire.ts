export const KEY = {
  right: 0xae,
  left: 0xac,
  up: 0xad,
  down: 0xaf,
  strafeLeft: 0xa0,
  strafeRight: 0xa1,
  use: 0xa2,
  fire: 0xa3,
  escape: 27,
  enter: 13,
  tab: 9,
  pause: 0xff,
  shift: 0x80 + 0x36,
  y: 0x79,
  n: 0x6e,
} as const

export type Control = {
  readonly key: string
  readonly hotkey: string
  readonly label: string
  readonly codes: readonly number[]
  readonly toggles?: true
}

export const CONTROLS: readonly Control[] = [
  { key: 'forward', hotkey: 'w', label: '↑', codes: [KEY.up] },
  { key: 'back', hotkey: 's', label: '↓', codes: [KEY.down] },
  { key: 'turnLeft', hotkey: 'a', label: '↶', codes: [KEY.left] },
  { key: 'turnRight', hotkey: 'd', label: '↷', codes: [KEY.right] },
  { key: 'strafeLeft', hotkey: 'q', label: '←', codes: [KEY.strafeLeft] },
  { key: 'strafeRight', hotkey: 'e', label: '→', codes: [KEY.strafeRight] },
  { key: 'fire', hotkey: 'f', label: 'fire', codes: [KEY.fire] },
  { key: 'use', hotkey: 'u', label: 'use', codes: [KEY.use] },
  { key: 'run', hotkey: 'r', label: 'run', codes: [KEY.shift], toggles: true },
  { key: 'enter', hotkey: 'n', label: 'enter', codes: [KEY.enter] },
  { key: 'menu', hotkey: 'x', label: 'menu', codes: [KEY.escape] },
  { key: 'yes', hotkey: 'y', label: 'yes', codes: [KEY.y] },
  { key: 'map', hotkey: 'm', label: 'map', codes: [KEY.tab] },
  { key: 'pause', hotkey: 'p', label: 'pause', codes: [KEY.pause] },
]

const WEAPON_NAMES = ['fist', 'pistol', 'shotgun', 'chaingun', 'rocket', 'plasma', 'bfg'] as const

export const WEAPONS: readonly Control[] = WEAPON_NAMES.map((name, i) => ({
  key: `weapon${i + 1}`,
  hotkey: String(i + 1),
  label: name,
  codes: [0x31 + i],
}))

export const HOLD_MS = 160

export type KeyEvent = { readonly seq: number; readonly isDown: boolean; readonly code: number }

export type Held = { readonly code: number; readonly until: number; readonly isToggled: boolean }

export type KeyLog = {
  readonly seq: number
  readonly held: readonly Held[]
  readonly events: readonly KeyEvent[]
}

export const emptyLog = (): KeyLog => ({ seq: 0, held: [], events: [] })

const KEPT_EVENTS = 64

const append = (log: KeyLog, isDown: boolean, code: number): KeyLog => {
  const seq = log.seq + 1
  return { ...log, seq, events: [...log.events, { seq, isDown, code }].slice(-KEPT_EVENTS) }
}

export const press = (log: KeyLog, control: Control, now: number): KeyLog => {
  let out = log
  for (const code of control.codes) {
    const already = out.held.find(h => h.code === code)
    if (control.toggles) {
      if (already?.isToggled) {
        out = append(out, false, code)
        out = { ...out, held: out.held.filter(h => h.code !== code) }
      } else {
        if (already === undefined) out = append(out, true, code)
        out = { ...out, held: [...out.held.filter(h => h.code !== code), { code, until: Number.POSITIVE_INFINITY, isToggled: true }] }
      }
      continue
    }
    if (already === undefined) out = append(out, true, code)
    out = { ...out, held: [...out.held.filter(h => h.code !== code), { code, until: now + HOLD_MS, isToggled: false }] }
  }
  return out
}

export const releaseDue = (log: KeyLog, now: number): KeyLog => {
  let out = log
  for (const h of log.held) {
    if (h.until > now) continue
    out = append(out, false, h.code)
    out = { ...out, held: out.held.filter(k => k.code !== h.code) }
  }
  return out
}

export const releaseAll = (log: KeyLog): KeyLog => {
  let out = log
  for (const h of log.held) out = append(out, false, h.code)
  return { ...out, held: [] }
}

export const serialize = (log: KeyLog): string => log.events.map(e => `${e.seq} ${e.isDown ? 'd' : 'u'} ${e.code}`).join('\n') + '\n'

export type Split = { readonly lines: readonly string[]; readonly rest: string }

export const splitLines = (rest: string, chunk: string): Split => {
  const text = rest + chunk
  const parts = text.split('\n')
  const tail = parts.pop() ?? ''
  return { lines: parts, rest: tail }
}

export type Shape = { readonly columns: number; readonly rows: number }

export type Display = 'image' | 'cells'

export const MIN_COLUMNS = 40
export const MAX_COLUMNS = 512
export const MAX_IMAGE_COLUMNS = 255
export const MAX_AUTO_COLUMNS = 160
export const PANE_FRAME_COLUMNS = 6

// DOOM was drawn for 4:3 screens. How many rows make a 4:3 box depends on the
// cell's own shape, width over height: 7x15 and 8x17 coding fonts sit near
// 0.47, a 1:2 bitmap font at 0.5. Nothing reports it, so it is a setting.
export const DEFAULT_CELL_ASPECT = 0.47
const PICTURE_ASPECT = 4 / 3

export const clampCellAspect = (aspect: number): number => (Number.isFinite(aspect) ? Math.max(0.3, Math.min(0.8, aspect)) : DEFAULT_CELL_ASPECT)

const rowsPerColumn = (cellAspect: number): number => cellAspect / PICTURE_ASPECT

export const NATIVE_WIDTH = 320
export const NATIVE_HEIGHT = 240

// Rows the pane cannot give the picture: its frame, the two hotkey rows, and
// the transcript lines, prompt and footer that must stay on screen with it.
export const CHROME_ROWS = 16

export const autoColumns = (terminalColumns: number, terminalRows?: number, cellAspect = DEFAULT_CELL_ASPECT): number => {
  const byWidth = Math.min(MAX_AUTO_COLUMNS, terminalColumns - PANE_FRAME_COLUMNS)
  if (terminalRows === undefined) return byWidth
  const byHeight = Math.floor((terminalRows - CHROME_ROWS) / rowsPerColumn(cellAspect))
  return Math.max(MIN_COLUMNS, Math.min(byWidth, byHeight))
}

export const clampFps = (fps: number): number => (Number.isFinite(fps) ? Math.max(5, Math.min(35, Math.round(fps))) : 15)

export const shapeFor = (columns: number, display: Display = 'cells', cellAspect = DEFAULT_CELL_ASPECT): Shape => {
  const max = display === 'image' ? MAX_IMAGE_COLUMNS : MAX_COLUMNS
  const cols = Math.max(MIN_COLUMNS, Math.min(max, Math.floor(columns)))
  const rows = Math.max(12, Math.min(255, Math.round(cols * rowsPerColumn(cellAspect))))
  return { columns: cols, rows }
}

export type DisplayHints = {
  readonly termProgram?: string
  readonly kittyWindow?: string
  readonly tmux?: string
}

const IMAGE_TERMINALS = new Set(['ghostty', 'kitty', 'wezterm'])

export const pickDisplay = (hints: DisplayHints): Display => {
  if (hints.tmux !== undefined && hints.tmux !== '') return 'cells'
  if (hints.kittyWindow !== undefined && hints.kittyWindow !== '') return 'image'
  return IMAGE_TERMINALS.has((hints.termProgram ?? '').toLowerCase()) ? 'image' : 'cells'
}

export const parseDisplay = (word: string): Display | undefined => (word === 'image' || word === 'cells' ? word : undefined)

export const IMAGE_DENIES_BEFORE_FALLBACK = 20

export const isImageRefusal = (deny: string): boolean => /\balt\b|image|picture|placeholder/i.test(deny)

export const cellsLength = ({ columns, rows }: Shape): number => Math.ceil((columns * rows * 12) / 3) * 4

export const blankCells = ({ columns, rows }: Shape): string => {
  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < columns * rows; i++) {
    view.setUint32(i * 12, 0x2580, true)
    view.setUint32(i * 12 + 4, 0x101018, true)
    view.setUint32(i * 12 + 8, 0x101018, true)
  }
  return toBase64(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += b === undefined ? '=' : B64[(n >> 6) & 63]
    out += c === undefined ? '=' : B64[n & 63]
  }
  return out
}
