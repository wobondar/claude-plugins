import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { TetrisGame, TetrisLive } from '../types'
import { FRAME_MS } from '../hooks/game'
import { LOCK_MS } from '../hooks/tetris'

const PLUGIN = 'slop-tetris'
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const PANE = {
  plugin: PLUGIN,
  surface: 'terminal',
  component: 'Pane',
  requestId: 'slop-tetris',
  props: { title: 'Slop Tetris', isFocused: true, bodyColumns: 48, placement: 'inline', scroll: { offset: 0, bodyRows: 24 }, view: {} },
} as const

type Seen = { opened: Array<{ id: string; focus?: true }>; closed: string[]; commands: string[]; state: Record<string, unknown> }

const world = (on: On) => {
  const seen: Seen = { opened: [], closed: [], commands: [], state: {} }
  mock.store(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  on('state.set', ($, e, next) => {
    seen.state[e.key] = e.value
    return next(e)
  })
  on('ui.open', ($, e) => {
    seen.opened.push({ id: e.id, focus: e.focus })
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.message', () => ({}))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return { seen, clock }
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const liveOf = (seen: Seen): TetrisLive => seen.state.live as TetrisLive

describe('command', () => {
  test('/tetris is registered at session start and opens a focused pane', async ($, on) => {
    const { seen } = world(on)
    await start($)
    expect(seen.commands).toEqual(['tetris'])
    const result = await $.command.run({ command: 'tetris', args: '', ...RUN })
    expect(result.text).toContain('Tetris is up')
    expect(seen.opened).toEqual([{ id: 'slop-tetris', focus: true }])
    expect(liveOf(seen).isOpen).toBe(true)
  })

  test('/tetris close closes the pane', async ($, on) => {
    const { seen } = world(on)
    await start($)
    await $.command.run({ command: 'tetris', args: '', ...RUN })
    const result = await $.command.run({ command: 'tetris', args: 'close', ...RUN })
    expect(result.text).toBe('Tetris closed.')
    expect(seen.closed).toEqual(['slop-tetris'])
    expect(liveOf(seen).isOpen).toBe(false)
  })
})

describe('pane', () => {
  test('draws the board, the side panel and the key echo', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ in: 'game', text: 'HOLD' })).toBeDefined()
    expect(await ui.find({ in: 'game', text: 'NEXT' })).toBeDefined()
    expect(await ui.find({ in: 'game', text: 'SCORE' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(8)
    await ui.unmount()
  })

  test('keys reach the game once the board has the focus', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.key({ key: 'left', in: 'game' })
    await ui.key({ key: ' ', in: 'game' })
    expect(liveOf(seen).pieces).toBe(2)
    expect(liveOf(seen).score).toBeGreaterThan(0)
    await ui.unmount()
  })

  test('the frame clock pulls pieces down and locks them', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const ui = await $.ui.mount(PANE)
    expect(liveOf(seen).pieces).toBe(1)
    await ui.advance(20 * 1000 + LOCK_MS + FRAME_MS * 2)
    expect(liveOf(seen).pieces).toBe(2)
    await ui.unmount()
  })

  test('pause shows PAUSED and freezes the fall', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.key({ key: 'p', in: 'game' })
    expect(await ui.find({ in: 'game', text: 'PAUSED' })).toBeDefined()
    expect(liveOf(seen).phase).toBe('paused')
    await ui.advance(30 * 1000)
    expect(liveOf(seen).pieces).toBe(1)
    await ui.key({ key: 'p', in: 'game' })
    expect(liveOf(seen).phase).toBe('playing')
    await ui.unmount()
  })

  test('a game over writes lastGame, keeps the high score and restarts on enter', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const ui = await $.ui.mount(PANE)
    for (let i = 0; i < 60 && (seen.state.lastGame ?? null) === null; i++) await ui.key({ key: ' ', in: 'game' })
    const last = seen.state.lastGame as TetrisGame
    expect(last.pieces).toBeGreaterThan(5)
    expect(last.score).toBeGreaterThan(0)
    expect(await ui.find({ in: 'game', text: 'GAME OVER' })).toBeDefined()
    expect(seen.state.highScore).toBe(last.score)
    await ui.key({ key: 'return', in: 'game' })
    expect(liveOf(seen).phase).toBe('playing')
    expect(liveOf(seen).pieces).toBe(1)
    expect(await ui.find({ in: 'game', text: 'GAME OVER' })).toBeUndefined()
    await ui.unmount()
  })

  test('other surfaces get a text fallback', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
    expect(await ui.find({ text: /Runs in the terminal/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('buttons', () => {
  test('the hotkey buttons drive the game while the pane has focus', async ($, on) => {
    const { seen } = world(on)
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'hard' })
    await ui.advance(FRAME_MS)
    expect(liveOf(seen).pieces).toBe(2)
    await ui.press({ key: 'pause' })
    await ui.advance(FRAME_MS)
    expect(liveOf(seen).phase).toBe('paused')
    await ui.press({ key: 'new' })
    await ui.advance(FRAME_MS)
    expect(liveOf(seen).pieces).toBe(1)
    expect(liveOf(seen).phase).toBe('playing')
    await ui.unmount()
  })
})
