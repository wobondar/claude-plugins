import type { ClientKeyEvent, ClientModule, ClientSurface, RenderElement, RenderNode } from 'claude-code'

import {
  CLEAR_NAMES, COLS, PREVIEW, ROWS, act, cellsOf, createGame, ghost, nextSeed, tick,
} from './tetris'
import type { Action, Cell, Game, Phase, Piece, PieceKind } from './tetris'

export type GameCommand = { readonly seq: number; readonly action: Action | 'new' }
export type GameProps = { readonly seed: number; readonly highScore: number; readonly command?: GameCommand }

export type GameSummary = {
  readonly kind: 'tick' | 'gameOver'
  readonly score: number
  readonly lines: number
  readonly level: number
  readonly pieces: number
  readonly phase: Phase
}

type State = {
  game: Game
  banner: string
  bannerUntil: number
  now: number
}

export const FRAME_MS = 50
const BANNER_MS = 1200
const WIDTH = 44

const COLORS: Record<PieceKind, string> = {
  I: '#00e5ff',
  O: '#ffe600',
  T: '#c74dff',
  S: '#4cff5a',
  Z: '#ff4b4b',
  J: '#4d7cff',
  L: '#ff9d1c',
}

const WELL = '#0b0b14'
const FRAME = '#8a7cff'
const GHOST = '#3a3a55'
const INK = '#e6e6f0'
const DIM = '#7a7a90'
const GOLD = '#ffd700'

const summarize = (g: Game): GameSummary => ({
  kind: g.phase === 'over' ? 'gameOver' : 'tick', score: g.score, lines: g.lines, level: g.level, pieces: g.pieces, phase: g.phase,
})

const differs = (a: GameSummary | null, b: GameSummary): boolean =>
  a === null || a.score !== b.score || a.lines !== b.lines || a.level !== b.level || a.phase !== b.phase || a.pieces !== b.pieces

let lastSent: GameSummary | null = null

const report = (surface: ClientSurface<State>, g: Game): void => {
  const summary = summarize(g)
  if (!differs(lastSent, summary)) return
  lastSent = summary
  surface.post(summary)
}

const commit = (surface: ClientSurface<State>, prev: State, game: Game, patch: Partial<State> = {}): void => {
  let banner = prev.banner
  let bannerUntil = prev.bannerUntil
  if (game.pieces !== prev.game.pieces && game.lastClear > 0) {
    banner = CLEAR_NAMES[game.lastClear] ?? ''
    bannerUntil = prev.now + BANNER_MS
  }
  if (game.level > prev.game.level) {
    banner = `LEVEL ${game.level}`
    bannerUntil = prev.now + BANNER_MS
  }
  surface.setState({ ...prev, ...patch, game, banner, bannerUntil })
}

const ACTIONS: Record<string, Action> = {
  left: 'left',
  a: 'left',
  right: 'right',
  d: 'right',
  up: 'cw',
  w: 'cw',
  x: 'cw',
  z: 'ccw',
  q: 'ccw',
  e: 'flip',
  down: 'soft',
  s: 'soft',
  ' ': 'hard',
  space: 'hard',
  f: 'hard',
  c: 'hold',
  p: 'pause',
}

const restart = (surface: ClientSurface<State>, s: State): void => {
  surface.setState({ ...s, game: createGame(nextSeed(s.game)), banner: 'GO!', bannerUntil: s.now + BANNER_MS })
}

let lastSeq = 0

const obey = (surface: ClientSurface<State>, s: State, command: GameCommand | undefined): void => {
  if (command === undefined || command.seq === lastSeq) return
  lastSeq = command.seq
  if (command.action === 'new') return restart(surface, s)
  commit(surface, s, act(s.game, command.action))
}

const onKey = (surface: ClientSurface<State>) => (e: ClientKeyEvent): void => {
  const s = surface.state
  if (s === undefined) return
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key === 'r' || (s.game.phase === 'over' && key === 'return')) return restart(surface, s)
  const action = ACTIONS[key]
  if (action !== undefined) commit(surface, s, act(s.game, action))
}

const onTick = (surface: ClientSurface<State>) => (): void => {
  const s = surface.state
  if (s === undefined) return
  const now = s.now + FRAME_MS
  const game = tick(s.game, FRAME_MS)
  commit(surface, { ...s, now }, game, s.banner !== '' && now >= s.bannerUntil ? { banner: '' } : {})
}

const boot = (props: GameProps, surface: ClientSurface<State>): State => {
  const state: State = { game: createGame(props.seed), banner: 'GO!', bannerUntil: BANNER_MS, now: 0 }
  lastSent = null
  lastSeq = props.command?.seq ?? 0
  surface.setState(state)
  surface.every(FRAME_MS, onTick(surface))
  surface.onKey(onKey(surface))
  return state
}

type Grid = Array<Array<{ glyph: string; color: string }>>

const buildGrid = (g: Game): Grid => {
  const grid: Grid = g.board.map(row => row.map((c: Cell) => (c === null ? { glyph: '  ', color: WELL } : { glyph: '██', color: COLORS[c] })))
  if (g.phase !== 'over') {
    for (const [x, y] of cellsOf(ghost(g))) {
      if (y >= 0 && y < ROWS && grid[y]?.[x]?.glyph === '  ') (grid[y] as Grid[number])[x] = { glyph: '░░', color: GHOST }
    }
    for (const [x, y] of cellsOf(g.current)) {
      if (y >= 0 && y < ROWS) (grid[y] as Grid[number])[x] = { glyph: '██', color: COLORS[g.current.kind] }
    }
  }
  return grid
}

const centered = (text: string, width: number): string => {
  const pad = Math.max(0, width - text.length)
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + text + ' '.repeat(pad - left)
}

const miniPiece = (kind: PieceKind | null, elements: ClientSurface<State>['elements']): RenderElement[] => {
  const { Box, Text } = elements
  const rows: RenderElement[] = []
  const occupied = new Set<string>()
  if (kind !== null) {
    const p: Piece = { kind, rotation: 0, x: 0, y: 0 }
    for (const [x, y] of cellsOf(p)) occupied.add(`${x},${y}`)
  }
  const top = kind === 'I' ? 1 : 0
  for (let y = top; y < top + 2; y++) {
    const cells: RenderNode[] = []
    for (let x = 0; x < 4; x++) {
      const on = occupied.has(`${x},${y}`)
      cells.push(<Text color={on && kind !== null ? COLORS[kind] : WELL}>{on ? '██' : '  '}</Text>)
    }
    rows.push(<Box flexDirection="row">{cells}</Box>)
  }
  return rows
}

const formatScore = (n: number): string => n.toLocaleString('en-US')

const Tetris: ClientModule<GameProps, State> = (props, surface) => {
  const s = surface.state ?? boot(props, surface)
  const { Box, Text } = surface.elements
  obey(surface, s, props.command)
  const g = s.game
  report(surface, g)
  const grid = buildGrid(g)

  const overlay: string[] =
    g.phase === 'over' ? ['GAME OVER', formatScore(g.score), g.score > props.highScore && props.highScore > 0 ? 'NEW BEST' : '', 'r: again'] : []
  const overlayTop = Math.floor((ROWS - overlay.length) / 2)
  const status = g.phase === 'paused' ? 'PAUSED  p: resume' : g.phase === 'over' ? 'GAME OVER  r: new' : s.banner

  const boardRows: RenderElement[] = grid.map((row, y) => {
    const line = overlay[y - overlayTop]
    if (line !== undefined) {
      return (
        <Box flexDirection="row">
          <Text color="#ff4b4b" bold backgroundColor="#1a1a2e">{centered(line, COLS * 2)}</Text>
        </Box>
      )
    }
    return <Box flexDirection="row">{row.map(c => <Text color={c.color} backgroundColor={WELL}>{c.glyph}</Text>)}</Box>
  })

  const best = Math.max(props.highScore, g.score)

  return (
    <Box flexDirection="row" width={WIDTH} height={ROWS + 2}>
      <Box flexDirection="column" borderStyle="double" borderColor={FRAME} width={COLS * 2 + 2}>
        {boardRows}
      </Box>
      <Box flexDirection="column" paddingLeft={1} width={WIDTH - COLS * 2 - 2}>
        <Text color={DIM}>HOLD{g.canHold ? '' : ' ·'}</Text>
        {miniPiece(g.hold, surface.elements)}
        <Text color={DIM}>NEXT</Text>
        {g.queue.slice(0, PREVIEW).flatMap(k => miniPiece(k, surface.elements))}
        <Box marginTop={1} flexDirection="column">
          <Text color={DIM}>SCORE</Text>
          <Text color={INK} bold>{formatScore(g.score)}</Text>
          <Text color={DIM}>LINES <Text color={INK}>{g.lines}</Text>  LVL <Text color={INK}>{g.level}</Text></Text>
          <Text color={DIM}>BEST  <Text color={best === g.score && g.score > 0 ? GOLD : INK}>{formatScore(best)}</Text></Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={GOLD} bold>{status === '' ? ' ' : status}</Text>
          <Text color={DIM}>esc: back to prompt</Text>
        </Box>
      </Box>
    </Box>
  )
}

export default Tetris
