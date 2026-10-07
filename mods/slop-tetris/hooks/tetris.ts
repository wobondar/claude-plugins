export const COLS = 10
export const ROWS = 20
export const PREVIEW = 3
export const LOCK_MS = 500

export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
export const KINDS: readonly PieceKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

export type Rotation = 0 | 1 | 2 | 3
export type Cell = PieceKind | null
export type Row = readonly Cell[]
export type Board = readonly Row[]

export type Piece = { kind: PieceKind; rotation: Rotation; x: number; y: number }

export type Phase = 'playing' | 'paused' | 'over'

export type Game = {
  board: Board
  current: Piece
  queue: readonly PieceKind[]
  bag: readonly PieceKind[]
  hold: PieceKind | null
  canHold: boolean
  seed: number
  score: number
  lines: number
  level: number
  phase: Phase
  groundedMs: number
  fallMs: number
  lastClear: number
  pieces: number
}

type Offset = readonly [x: number, y: number]
type Shape = readonly [Offset, Offset, Offset, Offset]

const SHAPES: Record<PieceKind, readonly [Shape, Shape, Shape, Shape]> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
}

// SRS kick tables, y positive downwards (the guideline's tables are y-up, flipped here).
type Kicks = Record<`${Rotation}${Rotation}`, readonly Offset[]>

const KICKS: Kicks = {
  '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '00': [[0, 0]], '11': [[0, 0]], '22': [[0, 0]], '33': [[0, 0]],
  '02': [[0, 0], [0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0]],
  '20': [[0, 0], [0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0]],
  '13': [[0, 0], [1, 0], [1, -2], [1, -1], [0, -2], [0, -1]],
  '31': [[0, 0], [-1, 0], [-1, -2], [-1, -1], [0, -2], [0, -1]],
}

const I_KICKS: Kicks = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '00': [[0, 0]], '11': [[0, 0]], '22': [[0, 0]], '33': [[0, 0]],
  '02': [[0, 0], [0, -1], [0, 1]],
  '20': [[0, 0], [0, 1], [0, -1]],
  '13': [[0, 0], [1, 0], [-1, 0]],
  '31': [[0, 0], [-1, 0], [1, 0]],
}

export const cellsOf = (p: Piece): Offset[] => SHAPES[p.kind][p.rotation].map(([dx, dy]) => [p.x + dx, p.y + dy] as const)

export const emptyBoard = (): Board => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, (): Cell => null))

export const collides = (board: Board, p: Piece): boolean =>
  cellsOf(p).some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y]?.[x] !== null))

const nextRandom = (seed: number): number => {
  let s = seed >>> 0
  s ^= s << 13
  s >>>= 0
  s ^= s >>> 17
  s ^= s << 5
  return s >>> 0
}

const shuffledBag = (seed: number): { bag: PieceKind[]; seed: number } => {
  const bag = [...KINDS]
  let s = seed
  for (let i = bag.length - 1; i > 0; i--) {
    s = nextRandom(s)
    const j = s % (i + 1)
    const a = bag[i] as PieceKind
    bag[i] = bag[j] as PieceKind
    bag[j] = a
  }
  return { bag, seed: s }
}

const draw = (bag: readonly PieceKind[], seed: number, count: number): { drawn: PieceKind[]; bag: PieceKind[]; seed: number } => {
  let pool = [...bag]
  let s = seed
  const drawn: PieceKind[] = []
  while (drawn.length < count) {
    if (pool.length === 0) {
      const refill = shuffledBag(s)
      pool = refill.bag
      s = refill.seed
    }
    drawn.push(pool.shift() as PieceKind)
  }
  return { drawn, bag: pool, seed: s }
}

export const spawn = (kind: PieceKind): Piece => ({ kind, rotation: 0, x: 3, y: kind === 'I' ? -1 : 0 })

export const createGame = (seed: number): Game => {
  const first = draw([], seed || 0x9e3779b9, PREVIEW + 1)
  const [kind, ...queue] = first.drawn
  return {
    board: emptyBoard(),
    current: spawn(kind as PieceKind),
    queue,
    bag: first.bag,
    hold: null,
    canHold: true,
    seed: first.seed,
    score: 0,
    lines: 0,
    level: 1,
    phase: 'playing',
    groundedMs: 0,
    fallMs: 0,
    lastClear: 0,
    pieces: 1,
  }
}

export const gravityMs = (level: number): number => {
  const n = Math.min(level, 20) - 1
  return Math.max(16, Math.round(1000 * Math.pow(0.8 - n * 0.007, n)))
}

export const levelFor = (lines: number): number => Math.floor(lines / 10) + 1

const LINE_SCORE = [0, 100, 300, 500, 800] as const

const isGrounded = (g: Game): boolean => collides(g.board, { ...g.current, y: g.current.y + 1 })

const shifted = (g: Game, dx: number, dy: number): Game | null => {
  const moved = { ...g.current, x: g.current.x + dx, y: g.current.y + dy }
  return collides(g.board, moved) ? null : { ...g, current: moved, groundedMs: 0 }
}

export const moveLeft = (g: Game): Game => (g.phase !== 'playing' ? g : shifted(g, -1, 0) ?? g)
export const moveRight = (g: Game): Game => (g.phase !== 'playing' ? g : shifted(g, 1, 0) ?? g)

export const rotate = (g: Game, dir: 1 | -1 | 2): Game => {
  if (g.phase !== 'playing' || g.current.kind === 'O') return g
  const from = g.current.rotation
  const to = (((from + dir) % 4) + 4) % 4 as Rotation
  const table = g.current.kind === 'I' ? I_KICKS : KICKS
  for (const [kx, ky] of table[`${from}${to}`]) {
    const candidate: Piece = { ...g.current, rotation: to, x: g.current.x + kx, y: g.current.y + ky }
    if (!collides(g.board, candidate)) return { ...g, current: candidate, groundedMs: 0 }
  }
  return g
}

const place = (board: Board, p: Piece): Board => {
  const rows = board.map(r => [...r])
  for (const [x, y] of cellsOf(p)) {
    if (y >= 0) (rows[y] as Cell[])[x] = p.kind
  }
  return rows
}

const sweep = (board: Board): { board: Board; cleared: number } => {
  const kept = board.filter(r => r.some(c => c === null))
  const cleared = ROWS - kept.length
  const fresh = Array.from({ length: cleared }, () => Array.from({ length: COLS }, (): Cell => null))
  return { board: [...fresh, ...kept], cleared }
}

export const lock = (g: Game): Game => {
  const placed = place(g.board, g.current)
  const { board, cleared } = sweep(placed)
  const lines = g.lines + cleared
  const level = levelFor(lines)
  const score = g.score + (LINE_SCORE[cleared] ?? 1200) * g.level
  const pulled = draw(g.bag, g.seed, 1)
  const [kind] = g.queue
  const queue = [...g.queue.slice(1), ...pulled.drawn]
  const current = spawn(kind as PieceKind)
  const over = collides(board, current) || cellsOf(g.current).every(([, y]) => y < 0)
  return {
    ...g,
    board,
    current,
    queue,
    bag: pulled.bag,
    seed: pulled.seed,
    canHold: true,
    score,
    lines,
    level,
    phase: over ? 'over' : 'playing',
    groundedMs: 0,
    fallMs: 0,
    lastClear: cleared,
    pieces: g.pieces + 1,
  }
}

export const softDrop = (g: Game): Game => {
  if (g.phase !== 'playing') return g
  const down = shifted(g, 0, 1)
  return down ? { ...down, score: down.score + 1 } : g
}

export const dropDistance = (g: Game): number => {
  let d = 0
  while (!collides(g.board, { ...g.current, y: g.current.y + d + 1 })) d++
  return d
}

export const ghost = (g: Game): Piece => ({ ...g.current, y: g.current.y + dropDistance(g) })

export const hardDrop = (g: Game): Game => {
  if (g.phase !== 'playing') return g
  const d = dropDistance(g)
  return lock({ ...g, current: { ...g.current, y: g.current.y + d }, score: g.score + d * 2 })
}

export const holdPiece = (g: Game): Game => {
  if (g.phase !== 'playing' || !g.canHold) return g
  const held = g.current.kind
  if (g.hold === null) {
    const pulled = draw(g.bag, g.seed, 1)
    const [kind] = g.queue
    const current = spawn(kind as PieceKind)
    return { ...g, hold: held, canHold: false, current, queue: [...g.queue.slice(1), ...pulled.drawn], bag: pulled.bag, seed: pulled.seed, groundedMs: 0, fallMs: 0, phase: collides(g.board, current) ? 'over' : 'playing' }
  }
  const current = spawn(g.hold)
  return { ...g, hold: held, canHold: false, current, groundedMs: 0, fallMs: 0, phase: collides(g.board, current) ? 'over' : 'playing' }
}

export const togglePause = (g: Game): Game =>
  g.phase === 'playing' ? { ...g, phase: 'paused' } : g.phase === 'paused' ? { ...g, phase: 'playing' } : g

export const tick = (g: Game, dtMs: number): Game => {
  if (g.phase !== 'playing') return g
  if (isGrounded(g)) {
    const groundedMs = g.groundedMs + dtMs
    return groundedMs >= LOCK_MS ? lock(g) : { ...g, groundedMs, fallMs: 0 }
  }
  let fallMs = g.fallMs + dtMs
  const step = gravityMs(g.level)
  let out: Game = g
  while (fallMs >= step) {
    fallMs -= step
    const down = shifted(out, 0, 1)
    if (!down) break
    out = down
  }
  return { ...out, fallMs, groundedMs: 0 }
}

export type Action = 'left' | 'right' | 'cw' | 'ccw' | 'flip' | 'soft' | 'hard' | 'hold' | 'pause'

export const act = (g: Game, action: Action): Game => {
  switch (action) {
    case 'left': return moveLeft(g)
    case 'right': return moveRight(g)
    case 'cw': return rotate(g, 1)
    case 'ccw': return rotate(g, -1)
    case 'flip': return rotate(g, 2)
    case 'soft': return softDrop(g)
    case 'hard': return hardDrop(g)
    case 'hold': return holdPiece(g)
    case 'pause': return togglePause(g)
  }
}

export const nextSeed = (g: Game): number => nextRandom(g.seed ^ (g.score + 1) ^ (g.pieces << 8))

export const CLEAR_NAMES = ['', 'single', 'double', 'triple', 'TETRIS'] as const
