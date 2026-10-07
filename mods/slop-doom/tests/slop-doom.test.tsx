import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DoomScreen } from '../types'
import { KEY, blankCells } from '../hooks/wire'

const PLUGIN = 'slop-doom'
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const PANE = {
  plugin: PLUGIN,
  surface: 'terminal',
  component: 'Pane',
  requestId: 'slop-doom',
  props: { title: 'Slop Doom', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const FRAME = blankCells({ columns: 80, rows: 24 })

type Seen = { spawns: string[][]; writes: Record<string, string>; blits: string[]; opened: string[]; closed: string[]; state: Record<string, unknown> }

const world = (on: On, { frames = 2 }: { frames?: number } = {}) => {
  const seen: Seen = { spawns: [], writes: {}, blits: [], opened: [], closed: [], state: {} }
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('state.set', ($, e, next) => {
    seen.state[e.key] = e.value
    return next(e)
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.blit', ($, e) => {
    seen.blits.push('cells' in e ? e.cells : '')
    return { value: {} }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    seen.writes[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', ($, e) => ({ value: { exitCode: e.argv[0] === 'bun' ? 0 : 1, stdout: '1.0.0\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* ($, e) {
    seen.spawns.push([...e.argv])
    yield { stream: 'stdout' as const, text: 'L ready 640x400\nF ' + FRAME.slice(0, 10) }
    for (let i = 0; i < frames; i++) {
      await clock.sleep(50)
      yield { stream: 'stdout' as const, text: (i === 0 ? FRAME.slice(10) : 'F ' + FRAME) + '\n' }
    }
    await clock.sleep(10_000)
    return { value: { code: 0, signal: null } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return { seen, clock }
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const screenOf = (seen: Seen): DoomScreen => seen.state.screen as DoomScreen
const keysFile = (seen: Seen): string => Object.values(seen.writes).at(-1) ?? ''

describe('command', () => {
  test('/doom opens a focused pane, picks a runner and spawns the sidecar', async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    const result = await $.command.run({ command: 'doom', args: '', ...RUN })
    expect(result.text).toContain('Doom is up at 114x68, 15 fps')
    expect(seen.opened).toEqual(['slop-doom'])
    await clock.advance(200)
    expect(seen.spawns).toHaveLength(1)
    const argv = seen.spawns[0] as string[]
    expect(argv[0]).toBe('bun')
    expect(argv[1]?.endsWith('/sidecar/doom.ts')).toBe(true)
    expect(argv).toContain('--cols')
    expect(argv.slice(argv.indexOf('--fps'))).toEqual(['--fps', '15'])
    expect(screenOf(seen).isRunning).toBe(true)
  })

  test('an explicit width wins over the terminal fit', async ($, on) => {
    world(on)
    await start($)
    expect((await $.command.run({ command: 'doom', args: '80 12', ...RUN })).text).toContain('Doom is up at 80x48, 12 fps')
  })

  test('frames from the sidecar are blitted into the Raster', async ($, on) => {
    const { seen, clock } = world(on, { frames: 3 })
    await start($)
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(500)
    expect(seen.blits).toHaveLength(3)
    expect(seen.blits[0]).toBe(FRAME)
    expect(screenOf(seen).status).toBe('running')
  })

  test('/doom close releases keys, stops the pump and closes the pane', async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(100)
    const result = await $.command.run({ command: 'doom', args: 'close', ...RUN })
    expect(result.text).toBe('Doom closed.')
    expect(seen.closed).toEqual(['slop-doom'])
    expect(screenOf(seen).isRunning).toBe(false)
    const before = seen.blits.length
    await clock.advance(1000)
    expect(seen.blits.length).toBe(before)
  })
})

describe('pane', () => {
  test('draws a Raster of the chosen shape and the hotkey strip', async ($, on) => {
    const { clock } = world(on)
    await start($)
    await $.command.run({ command: 'doom', args: '120', ...RUN })
    await clock.advance(100)
    const ui = await $.ui.mount(PANE)
    const raster = await ui.find({ type: 'Raster', key: 'screen' })
    expect(raster).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(21)
    await ui.unmount()
  })

  test('a hotkey writes a key down to the keys file and a key up after the hold', async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(100)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'fire' })
    expect(keysFile(seen)).toBe(`1 d ${KEY.fire}\n`)
    await clock.advance(300)
    expect(keysFile(seen)).toBe(`1 d ${KEY.fire}\n2 u ${KEY.fire}\n`)
    await ui.press({ key: 'run' })
    await clock.advance(1000)
    expect(keysFile(seen)).toContain(`3 d ${KEY.shift}\n`)
    expect(keysFile(seen)).not.toContain(`u ${KEY.shift}`)
    await ui.unmount()
  })
})
