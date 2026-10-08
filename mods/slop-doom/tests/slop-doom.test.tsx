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

const FRAME = blankCells({ columns: 80, rows: 30 })

type Blit = { cells?: string; source?: unknown }
type Seen = { spawns: string[][]; writes: Record<string, string>; blits: Blit[]; opened: string[]; closed: string[]; state: Record<string, unknown> }

type Env = Record<string, string | undefined>
type World = { frames?: number; env?: Env; denyImages?: boolean }

const world = (on: On, { frames = 2, env = {}, denyImages = false }: World = {}) => {
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
    if ('cells' in e) {
      seen.blits.push({ cells: e.cells })
      return { value: {} }
    }
    seen.blits.push({ source: e.source })
    return { value: denyImages ? { deny: 'the Image draws its alt there: no placeholder images' } : {} }
  })
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>the engine's band</Text>
  })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.write', ($, e) => {
    seen.writes[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', ($, e) => ({ value: { exitCode: e.argv[0] === 'bun' ? 0 : 1, stdout: '1.0.0\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* ($, e) {
    seen.spawns.push([...e.argv])
    if (e.argv.includes('--out')) {
      yield { stream: 'stdout' as const, text: 'L ready 640x400 -> 320x200\n' }
      for (let i = 1; i <= frames; i++) {
        await clock.sleep(50)
        yield { stream: 'stdout' as const, text: `I ${i}\n` }
      }
    } else {
      yield { stream: 'stdout' as const, text: 'L ready 640x400\nF ' + FRAME.slice(0, 10) }
      for (let i = 0; i < frames; i++) {
        await clock.sleep(50)
        yield { stream: 'stdout' as const, text: (i === 0 ? FRAME.slice(10) : 'F ' + FRAME) + '\n' }
      }
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
const GHOSTTY: Env = { TERM_PROGRAM: 'ghostty', TMPDIR: '/var/tmp/' }
const PIXELS = '/var/tmp/slop-doom-1000000.rgb'

describe('cells display', () => {
  test('/doom opens a focused pane, picks a runner and spawns the sidecar', async ($, on) => {
    const { seen, clock } = world(on)
    await start($)
    const result = await $.command.run({ command: 'doom', args: '', ...RUN })
    expect(result.text).toContain('Doom is up at 228x80 in 114x40 cells, 15 fps')
    expect(seen.opened).toEqual(['slop-doom'])
    await clock.advance(200)
    expect(seen.spawns).toHaveLength(1)
    const argv = seen.spawns[0] as string[]
    expect(argv[0]).toBe('bun')
    expect(argv[1]?.endsWith('/sidecar/doom.ts')).toBe(true)
    expect(argv).toContain('--cols')
    expect(argv).not.toContain('--out')
    expect(argv.slice(argv.indexOf('--fps'), argv.indexOf('--fps') + 2)).toEqual(['--fps', '15'])
    expect(argv.slice(argv.indexOf('--filter'))).toEqual(['--filter', 'mode', '--blocks', 'quad'])
    expect(argv[argv.indexOf('--keys') + 1]).toBe('/tmp/slop-doom-1000000.keys')
    expect(screenOf(seen).isRunning).toBe(true)
    expect(screenOf(seen).display).toBe('cells')
  })

  test('an explicit width and rate win over the terminal fit', async ($, on) => {
    world(on)
    await start($)
    expect((await $.command.run({ command: 'doom', args: '80 12', ...RUN })).text).toContain('Doom is up at 160x56 in 80x28 cells, 12 fps')
  })

  test('frames from the sidecar are blitted into the Raster', async ($, on) => {
    const { seen, clock } = world(on, { frames: 3 })
    await start($)
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(500)
    expect(seen.blits).toHaveLength(3)
    expect(seen.blits[0]?.cells).toBe(FRAME)
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

  test('a word that is neither a number nor a display is usage', async ($, on) => {
    world(on)
    await start($)
    expect((await $.command.run({ command: 'doom', args: 'huge', ...RUN })).text).toContain('Usage')
  })
})

describe('image display', () => {
  test('on Ghostty the sidecar writes native pixels and each frame swaps the Image', async ($, on) => {
    const { seen, clock } = world(on, { frames: 3, env: GHOSTTY })
    await start($)
    const result = await $.command.run({ command: 'doom', args: '', ...RUN })
    expect(result.text).toContain('Doom is up at 320x240 pixels over 114x40 cells')
    await clock.advance(500)
    const argv = seen.spawns[0] as string[]
    expect(argv.slice(argv.indexOf('--out'))).toEqual(['--out', PIXELS])
    expect(screenOf(seen).display).toBe('image')
    expect(screenOf(seen).picture).toEqual({ file: PIXELS, width: 320, height: 240, generation: 1 })
    expect(seen.blits).toHaveLength(3)
    expect(seen.blits[2]?.source).toEqual({ file: PIXELS, format: 'rgb', width: 320, height: 240, generation: 3 })
  })

  test('the auto width also fits the terminal height once a render has measured it', async ($, on) => {
    const { seen, clock } = world(on, { env: GHOSTTY })
    await start($)
    const band = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 200, scroll: { offset: 0, bodyRows: 4 }, view: {} },
      viewport: { columns: 200, rows: 50 },
    })
    await band.unmount()
    const result = await $.command.run({ command: 'doom', args: '', ...RUN, presentation: { isFullscreen: false, columns: 200 } })
    expect(result.text).toContain('over 96x34 cells')
    await clock.advance(100)
    expect(screenOf(seen).rows).toBe(34)
  })

  test('kitty is known by its window id, tmux forces cells, a word overrides both', async ($, on) => {
    const { seen, clock } = world(on, { env: { KITTY_WINDOW_ID: '3', TMUX: '/tmp/tmux-1/default,1,0' } })
    await start($)
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(100)
    expect(screenOf(seen).display).toBe('cells')
    await $.command.run({ command: 'doom', args: 'image', ...RUN })
    await clock.advance(100)
    expect(screenOf(seen).display).toBe('image')
    expect(seen.spawns).toHaveLength(2)
  })

  test('a terminal that refuses the Image gets the cells sidecar instead, and stays on it', async ($, on) => {
    const { seen, clock } = world(on, { frames: 3, env: GHOSTTY, denyImages: true })
    await start($)
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(1000)
    expect(seen.spawns).toHaveLength(2)
    expect(seen.spawns[0]).toContain('--out')
    expect(seen.spawns[1]).not.toContain('--out')
    expect(screenOf(seen).display).toBe('cells')
    expect(screenOf(seen).isRunning).toBe(true)
    expect(screenOf(seen).status).toContain('no pictures here')
    await $.command.run({ command: 'doom', args: 'close', ...RUN })
    await $.command.run({ command: 'doom', args: '', ...RUN })
    await clock.advance(100)
    expect(seen.spawns).toHaveLength(3)
    expect(seen.spawns[2]).not.toContain('--out')
  })
})

describe('pane', () => {
  test('draws a Raster of the chosen shape and the hotkey strip', async ($, on) => {
    const { clock } = world(on)
    await start($)
    await $.command.run({ command: 'doom', args: '120', ...RUN })
    await clock.advance(100)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Raster', key: 'screen' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(21)
    await ui.unmount()
  })

  test('draws an Image over the pixel file on the image display', async ($, on) => {
    const { clock } = world(on, { env: GHOSTTY })
    await start($)
    await $.command.run({ command: 'doom', args: '120', ...RUN })
    await clock.advance(100)
    const ui = await $.ui.mount(PANE)
    const image = await ui.find({ type: 'Image', key: 'screen' })
    expect(image).toBeDefined()
    expect(image?.props.columns).toBe(120)
    expect(image?.props.rows).toBe(42)
    expect(image?.props.source).toEqual({ file: PIXELS, format: 'rgb', width: 320, height: 240, generation: 1 })
    expect(await ui.find({ type: 'Raster', key: 'screen' })).toBeUndefined()
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
