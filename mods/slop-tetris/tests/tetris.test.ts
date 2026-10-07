import { describe, expect, test } from 'claude-code/testing'

import {
  COLS, KINDS, LOCK_MS, ROWS, act, cellsOf, collides, createGame, dropDistance, emptyBoard, ghost, gravityMs, hardDrop, holdPiece,
  levelFor, lock, moveLeft, moveRight, rotate, softDrop, spawn, tick, togglePause,
} from '../hooks/tetris'
import type { Board, Cell, Game, PieceKind } from '../hooks/tetris'

const withBoard = (g: Game, rows: string[]): Game => {
  const board: Cell[][] = emptyBoard().map(r => [...r])
  rows.forEach((text, i) => {
    const y = ROWS - rows.length + i
    ;[...text].forEach((ch, x) => {
      ;(board[y] as Cell[])[x] = ch === '.' ? null : 'J'
    })
  })
  return { ...g, board }
}

const filledCount = (board: Board): number => board.flat().filter(c => c !== null).length

describe('bag', () => {
  test('the first seven pieces are one of each kind', () => {
    let g = createGame(42)
    const seen: PieceKind[] = [g.current.kind]
    for (let i = 0; i < 6; i++) {
      g = hardDrop(g)
      seen.push(g.current.kind)
    }
    expect([...seen].sort()).toEqual([...KINDS].sort())
  })

  test('the same seed deals the same game', () => {
    const a = createGame(7)
    const b = createGame(7)
    expect(a.current).toEqual(b.current)
    expect(a.queue).toEqual(b.queue)
    expect(createGame(8).queue).not.toEqual(a.queue)
  })

  test('the preview holds three pieces', () => {
    expect(createGame(1).queue).toHaveLength(3)
    expect(hardDrop(createGame(1)).queue).toHaveLength(3)
  })
})

describe('movement', () => {
  test('left and right stop at the walls', () => {
    let g = createGame(3)
    for (let i = 0; i < 20; i++) g = moveLeft(g)
    expect(Math.min(...cellsOf(g.current).map(([x]) => x))).toBe(0)
    for (let i = 0; i < 20; i++) g = moveRight(g)
    expect(Math.max(...cellsOf(g.current).map(([x]) => x))).toBe(COLS - 1)
  })

  test('a spawned piece never collides on an empty board', () => {
    for (const kind of KINDS) expect(collides(emptyBoard(), spawn(kind))).toBe(false)
  })

  test('drop distance and ghost agree on an empty board', () => {
    const g = createGame(5)
    const d = dropDistance(g)
    expect(d).toBeGreaterThan(ROWS - 5)
    expect(ghost(g).y).toBe(g.current.y + d)
    expect(collides(g.board, { ...ghost(g), y: ghost(g).y + 1 })).toBe(true)
  })

  test('soft drop moves one row and pays one point', () => {
    const g = createGame(5)
    const s = softDrop(g)
    expect(s.current.y).toBe(g.current.y + 1)
    expect(s.score).toBe(1)
  })

  test('hard drop locks, pays two per row and spawns the next piece', () => {
    const g = createGame(5)
    const d = dropDistance(g)
    const h = hardDrop(g)
    expect(h.score).toBe(d * 2)
    expect(h.pieces).toBe(2)
    expect(h.current.kind).toBe(g.queue[0])
    expect(filledCount(h.board)).toBe(4)
  })
})

describe('rotation', () => {
  test('four clockwise turns come back around', () => {
    let g = { ...createGame(1), current: spawn('T') }
    g = softDrop(softDrop(g))
    const start = g.current
    for (let i = 0; i < 4; i++) g = rotate(g, 1)
    expect(g.current).toEqual(start)
  })

  test('O never rotates', () => {
    const g = { ...createGame(1), current: spawn('O') }
    expect(rotate(g, 1)).toBe(g)
  })

  test('a T against the left wall kicks in instead of refusing', () => {
    let g = { ...createGame(1), current: spawn('T') }
    g = softDrop(softDrop(g))
    for (let i = 0; i < 5; i++) g = moveLeft(g)
    g = rotate(g, 1)
    g = rotate(g, 1)
    const r = rotate(g, 1)
    expect(r.current.rotation).toBe(3)
    expect(cellsOf(r.current).every(([x]) => x >= 0)).toBe(true)
  })

  test('the I piece rotates in a crowded well through its own kick table', () => {
    const g = withBoard({ ...createGame(1), current: { kind: 'I', rotation: 1, x: 7, y: 10 } }, [
      '..........', '..........', '..........', '..........',
    ])
    const r = rotate(g, 1)
    expect(r.current.rotation).toBe(2)
    expect(collides(r.board, r.current)).toBe(false)
  })
})

describe('lines', () => {
  test('a full row clears and scores by level', () => {
    const g = withBoard({ ...createGame(1), current: { kind: 'I', rotation: 0, x: 6, y: ROWS - 2 } }, ['......JJJJ', 'JJJJJJ....'])
    const locked = lock({ ...g, current: { kind: 'I', rotation: 0, x: 6, y: ROWS - 2 } })
    expect(locked.lines).toBe(1)
    expect(locked.score).toBe(100)
    expect(locked.lastClear).toBe(1)
    expect(locked.board[ROWS - 1]).toEqual([...'......JJJJ'].map(ch => (ch === '.' ? null : 'J')))
  })

  test('a tetris pays 800 times the level', () => {
    const base = withBoard({ ...createGame(1), lines: 10, level: 2 }, ['JJJJJJJJJ.', 'JJJJJJJJJ.', 'JJJJJJJJJ.', 'JJJJJJJJJ.'])
    const vertical = { ...base, current: { kind: 'I' as const, rotation: 1 as const, x: 7, y: ROWS - 4 } }
    expect(collides(vertical.board, vertical.current)).toBe(false)
    const locked = lock(vertical)
    expect(locked.lines).toBe(14)
    expect(locked.score).toBe(1600)
    expect(locked.lastClear).toBe(4)
    expect(filledCount(locked.board)).toBe(0)
  })

  test('levels climb every ten lines and gravity speeds up', () => {
    expect(levelFor(0)).toBe(1)
    expect(levelFor(9)).toBe(1)
    expect(levelFor(10)).toBe(2)
    expect(gravityMs(1)).toBe(1000)
    expect(gravityMs(5)).toBeLessThan(gravityMs(4))
    expect(gravityMs(30)).toBeGreaterThanOrEqual(16)
  })
})

describe('clock', () => {
  test('gravity pulls a piece down once its interval passes', () => {
    const g = createGame(2)
    expect(tick(g, 999).current.y).toBe(g.current.y)
    expect(tick(g, 1000).current.y).toBe(g.current.y + 1)
    expect(tick(g, 2500).current.y).toBe(g.current.y + 2)
  })

  test('a grounded piece locks after the lock delay', () => {
    let g = createGame(2)
    g = { ...g, current: ghost(g) }
    const resting = tick(g, LOCK_MS - 1)
    expect(resting.pieces).toBe(1)
    const locked = tick(resting, 1)
    expect(locked.pieces).toBe(2)
  })

  test('moving resets the lock delay', () => {
    let g = createGame(2)
    g = { ...g, current: ghost(g) }
    g = tick(g, LOCK_MS - 1)
    g = moveLeft(g)
    expect(g.groundedMs).toBe(0)
  })

  test('pause freezes the clock', () => {
    const g = togglePause(createGame(2))
    expect(g.phase).toBe('paused')
    expect(tick(g, 5000)).toBe(g)
    expect(togglePause(g).phase).toBe('playing')
  })
})

describe('hold', () => {
  test('hold swaps once per piece', () => {
    const g = createGame(9)
    const first = g.current.kind
    const held = holdPiece(g)
    expect(held.hold).toBe(first)
    expect(held.current.kind).toBe(g.queue[0])
    expect(held.canHold).toBe(false)
    expect(holdPiece(held)).toBe(held)
    const dropped = hardDrop(held)
    expect(dropped.canHold).toBe(true)
    const swapped = holdPiece(dropped)
    expect(swapped.current.kind).toBe(first)
  })
})

describe('game over', () => {
  test('a spawn into filled cells ends the game', () => {
    const rows = Array.from({ length: ROWS - 1 }, () => 'JJJJJJJJJ.')
    const g = withBoard({ ...createGame(1), current: { kind: 'O', rotation: 0, x: 3, y: 0 } }, rows)
    const over = hardDrop(g)
    expect(over.phase).toBe('over')
    expect(act(over, 'left')).toBe(over)
  })
})
