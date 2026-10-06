import type { MachineState, SlotSymbol } from './reels'
import { formatCld, symbolAt } from './reels'

export const DEFAULT = 0x01000000

const GOLD = 0xffd700
const RED = 0xff3b30
const GREEN = 0x34c759
const CYAN = 0x5ac8fa
const WHITE = 0xffffff
const BLACK = 0x101010
const BEIGE = 0xfbf0df
const CABINET = 0x3b1f5e
const CABINET_DIM = 0x2a1544
const WINDOW = 0x0b0b14
const LIGHT_OFF = 0x6b4f8a
const SILVER = 0xc0c0c0

type Rgb = readonly [number, number, number]

const RETRO: readonly Rgb[] = [
  [255, 0, 170], [255, 60, 60], [255, 140, 0], [255, 230, 0], [120, 255, 60],
  [0, 240, 200], [0, 170, 255], [150, 80, 255], [230, 0, 230],
]

const sampleGradient = (t: number): number => {
  const wrapped = ((t % 1) + 1) % 1
  const scaled = wrapped * RETRO.length
  const at = Math.floor(scaled) % RETRO.length
  const mix = scaled - Math.floor(scaled)
  const left = RETRO[at] as Rgb
  const right = RETRO[(at + 1) % RETRO.length] as Rgb
  const r = Math.round(left[0] + (right[0] - left[0]) * mix)
  const g = Math.round(left[1] + (right[1] - left[1]) * mix)
  const b = Math.round(left[2] + (right[2] - left[2]) * mix)
  return (r << 16) | (g << 8) | b
}

export const TITLE = ' SLOP MACHINE '
export const TITLE_COLUMNS = TITLE.length
export const TITLE_CYCLE_MS = 1600
export const TITLE_FRAME_MS = 140
const SIGN_BG = 0x2a0a4a
const BULB = 0xffffff

export type TitleOptions = { chaser: number; isFlashing: boolean }

export const renderTitle = (phase: number, { chaser, isFlashing }: TitleOptions = { chaser: -1, isFlashing: false }): Cell[] =>
  [...TITLE].map((ch, i) => {
    const cp = ch.codePointAt(0) ?? 32
    if (isFlashing) return [cp, chaser % 2 === 0 ? GOLD : BULB, chaser % 2 === 0 ? SIGN_BG : 0x5a1a8a] as const
    const lit = i === chaser % TITLE_COLUMNS || i === (chaser + 1) % TITLE_COLUMNS
    return [cp, lit ? BULB : sampleGradient(i / (TITLE_COLUMNS - 1) - phase), SIGN_BG] as const
  })

export type Cell = readonly [codePoint: number, fg: number, bg: number]

type Tile = readonly [readonly Cell[], readonly Cell[], readonly Cell[]]

export const TILE_COLUMNS = 7
export const TILE_ROWS = 3
export const FRAME_COLUMNS = 1 + TILE_COLUMNS * 3 + 2 + 1
export const FRAME_ROWS = 7

const row = (text: string, fg: number, bg: number = WINDOW, overrides: Record<number, Cell> = {}): Cell[] =>
  [...text].map((ch, x) => overrides[x] ?? ([ch.codePointAt(0) ?? 32, fg, bg] as const))

const plate = (text: string, fg: number, bg: number): Cell[] => [...text].map(ch => [ch.codePointAt(0) ?? 32, fg, bg] as const)

const TILES: Record<SlotSymbol, Tile> = {
  seven: [row('▀▀▀▀▀██', GOLD), row('    ▄█▀', GOLD), row('   ██  ', GOLD)],
  coin: [
    row('▗█████▖', GOLD),
    row('██   ██', GOLD, WINDOW, { 2: [32, BLACK, GOLD], 3: [36, BLACK, GOLD], 4: [32, BLACK, GOLD] }),
    row('▝█████▘', GOLD),
  ],
  diamond: [row(' ▄███▄ ', CYAN), row('███████', CYAN), row(' ▀███▀ ', CYAN)],
  bar: [row('▄▄▄▄▄▄▄', WHITE), plate('  BAR  ', BLACK, WHITE), row('▀▀▀▀▀▀▀', WHITE)],
  bun: [row('╭─────╮', BEIGE), row('│ bun │', BEIGE), row('╰─────╯', BEIGE)],
  cherry: [row('   ╱╲  ', GREEN), row('  ╱  ╲ ', GREEN), row(' ██  ██', RED)],
  any: [row('▚▞▚▞▚▞▚', RED), row('▐ any ▌', RED), row('▞▚▞▚▞▚▞', RED)],
}

const dim = (color: number): number => {
  if (color === DEFAULT) return color
  const r = Math.floor(((color >> 16) & 0xff) * 0.55)
  const g = Math.floor(((color >> 8) & 0xff) * 0.55)
  const b = Math.floor((color & 0xff) * 0.55)
  return (r << 16) | (g << 8) | b
}

const reelRows = (m: MachineState, r: number): Cell[][] => {
  const reel = m.reels[r] as { index: number; offset: number }
  const here = TILES[symbolAt(reel.index)]
  const next = TILES[symbolAt(reel.index + 1)]
  const spinning = !m.stopped[r]
  const rows: Cell[][] = []
  for (let k = 0; k < TILE_ROWS; k++) {
    const src = k + reel.offset
    const line = src < TILE_ROWS ? here[src as 0 | 1 | 2] : next[(src - TILE_ROWS) as 0 | 1 | 2]
    rows.push(spinning ? line.map(([cp, fg, bg]) => [cp, dim(fg), bg === WINDOW ? bg : dim(bg)] as const) : [...line])
  }
  return rows
}

const text = (s: string, width: number, fg: number, bg: number, align: 'left' | 'center' = 'center'): Cell[] => {
  const chars = [...s].slice(0, width)
  const pad = width - chars.length
  const left = align === 'center' ? Math.floor(pad / 2) : 0
  const cells: Cell[] = []
  for (let i = 0; i < width; i++) {
    const ch = chars[i - left]
    cells.push([ch === undefined ? 32 : (ch.codePointAt(0) ?? 32), fg, bg])
  }
  return cells
}

export type FrameOptions = {
  lit: number
  readout: string
  readoutColor?: number
}

export const renderFrame = (m: MachineState, { lit, readout, readoutColor }: FrameOptions): Cell[] => {
  const cells: Cell[] = []
  const pushRow = (r: Cell[]): void => {
    if (r.length !== FRAME_COLUMNS) throw new Error(`row is ${r.length} wide, want ${FRAME_COLUMNS}`)
    cells.push(...r)
  }

  const lights: Cell[] = []
  const hot = m.phase === 'spinning' || m.outcome?.tier === 'jackpot' || m.outcome?.tier === 'big'
  for (let x = 0; x < FRAME_COLUMNS; x++) {
    const on = hot ? (x + lit) % 2 === 0 : (x + lit) % 4 === 0
    lights.push([on ? 0x28f6 : 0x2840, on ? GOLD : LIGHT_OFF, CABINET])
  }
  pushRow(lights)

  pushRow(row('╔═══════╤═══════╤═══════╗', GOLD, CABINET))

  const reels = [0, 1, 2].map(r => reelRows(m, r))
  for (let k = 0; k < TILE_ROWS; k++) {
    const line: Cell[] = [[0x2551, GOLD, CABINET]]
    for (let r = 0; r < 3; r++) {
      line.push(...(reels[r]?.[k] ?? []))
      line.push(r < 2 ? [0x2502, SILVER, WINDOW] : [0x2551, GOLD, CABINET])
    }
    pushRow(line)
  }

  pushRow(row('╚═══════╧═══════╧═══════╝', GOLD, CABINET))
  pushRow(text(readout, FRAME_COLUMNS, readoutColor ?? WHITE, CABINET_DIM))

  return cells
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const packCells = (cells: readonly Cell[]): string => {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach(([cp, fg, bg], i) => {
    view.setUint32(i * 12, cp, true)
    view.setUint32(i * 12 + 4, fg, true)
    view.setUint32(i * 12 + 8, bg, true)
  })
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

export const readoutFor = (m: MachineState, bet: number, hint: string): { readout: string; color: number } => {
  if (m.phase === 'spinning') return { readout: (m.reels[0]?.offset ?? 0) === 1 ? '▸▸▸ spinning ▸▸▸' : ' ▸▸ spinning ▸▸ ', color: GOLD }
  if (m.phase === 'result' && m.outcome) {
    const o = m.outcome
    const sign = o.payout > 0 ? '+' : ''
    const color = o.tier === 'jackpot' ? GOLD : o.tier === 'cursed' ? RED : o.payout > 0 ? GREEN : SILVER
    return { readout: `${o.title} ${sign}${o.payout === 0 ? '' : formatCld(o.payout)}`.trim(), color }
  }
  return { readout: `BET ${bet} · ${hint}`, color: WHITE }
}

export const textReels = (m: MachineState): string[] => {
  const labels = m.reels.map((reel, r) => {
    const sym = symbolAt(reel.index)
    const label = sym === 'cherry' ? ' * ' : sym === 'diamond' ? ' <> ' : sym === 'seven' ? ' 7 ' : sym === 'coin' ? ' $ ' : sym
    return m.stopped[r] ? `[${label.padEnd(3)}]` : `~${label.padEnd(3)}~`
  })
  return [labels.join(' ')]
}
