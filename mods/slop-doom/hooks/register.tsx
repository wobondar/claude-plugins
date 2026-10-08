import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { DoomScreen } from '../types'
import { CONTROLS, DEFAULT_CELL_ASPECT, IMAGE_DENIES_BEFORE_FALLBACK, NATIVE_HEIGHT, NATIVE_WIDTH, WEAPONS, autoColumns, blankCells, cellsLength, clampCellAspect, clampFps, emptyLog, isImageRefusal, parseDisplay, pickDisplay, press, releaseAll, releaseDue, serialize, shapeFor, splitLines } from './wire'
import type { Control, Display, KeyLog, Shape } from './wire'

const PANE = 'slop-doom'
const RELEASE_TICK_MS = 40

const idleScreen = (): DoomScreen => ({ isRunning: false, display: 'cells', picture: null, columns: 80, rows: 30, status: 'idle', frames: 0 })

const screen = atom({ plugin: 'slop-doom', key: 'screen' } as const, idleScreen())

let fps = 15
let filter = 'mode'
let blocks = 'quad'
let cellAspect = DEFAULT_CELL_ASPECT
let configDisplay: Display | 'auto' = 'auto'
let frame: string | null = null
let keys: KeyLog = emptyLog()
let keysPath = ''
let outPath = ''
let runner = 'bun'
let generation = 0
let imageDenies = 0
let hasImageFailed = false
let terminalRows: number | undefined
let releaseTimer: { cancel: () => void } | null = null

const writeKeys = async ($: EngineInterface): Promise<void> => {
  if (keysPath === '') return
  await $.fs.write(keysPath, serialize(keys)).catch(() => undefined)
}

const tap = async ($: EngineInterface, control: Control): Promise<void> => {
  const s = await read($, screen)
  if (!s.isRunning) return
  keys = press(keys, control, await $.clock.now())
  await writeKeys($)
}

const startReleasing = ($: EngineInterface): void => {
  releaseTimer?.cancel()
  let chain = Promise.resolve()
  releaseTimer = $.clock.every(RELEASE_TICK_MS, () => {
    chain = chain.then(async () => {
      const now = await $.clock.now()
      const next = releaseDue(keys, now)
      if (next === keys) return
      keys = next
      await writeKeys($)
    })
  })
}

const pickRunner = async ($: EngineInterface): Promise<string> => {
  for (const candidate of ['bun', 'node']) {
    const probe = await $.process.run([candidate, '--version'], { timeoutMs: 5000 }).catch(() => null)
    if (probe !== null && probe.exitCode === 0) return candidate
  }
  return 'bun'
}

const pickDisplayHere = async ($: EngineInterface): Promise<Display> => {
  if (configDisplay !== 'auto') return configDisplay
  if (hasImageFailed) return 'cells'
  return pickDisplay({
    termProgram: await $.env.get('TERM_PROGRAM'),
    kittyWindow: await $.env.get('KITTY_WINDOW_ID'),
    tmux: await $.env.get('TMUX'),
  })
}

const scratchDir = async ($: EngineInterface): Promise<string> => {
  if (await $.fs.exists('/dev/shm')) return '/dev/shm'
  const tmp = await $.env.get('TMPDIR')
  return tmp === undefined || tmp === '' ? '/tmp' : tmp.replace(/\/$/, '')
}

const fallBackToCells = async ($: EngineInterface, shape: Shape, reason: string): Promise<void> => {
  hasImageFailed = true
  await halt($)
  await launch($, shapeFor(shape.columns, 'cells', cellAspect), 'cells')
  await update($, screen, held => ({ ...held, status: `cells (no pictures here: ${reason.slice(0, 80)})` }))
}

const showPicture = async ($: EngineInterface, shape: Shape, pictureGeneration: number): Promise<boolean> => {
  const result = await $.ui.blit({
    requestId: PANE,
    key: 'screen',
    source: { file: outPath, format: 'rgb', width: NATIVE_WIDTH, height: NATIVE_HEIGHT, generation: pictureGeneration },
  }).catch(() => ({ deny: 'blit threw' }))
  if (result.deny === undefined) {
    imageDenies = 0
    return true
  }
  imageDenies++
  if (isImageRefusal(result.deny) || imageDenies >= IMAGE_DENIES_BEFORE_FALLBACK) {
    await fallBackToCells($, shape, result.deny)
    return false
  }
  return true
}

const pump = async ($: EngineInterface, shape: Shape, display: Display, mine: number): Promise<void> => {
  const argv = [runner, `${$.plugin.root}/sidecar/doom.ts`, '--keys', keysPath, '--cols', String(shape.columns), '--rows', String(shape.rows), '--fps', String(fps), '--filter', filter, '--blocks', blocks]
  if (display === 'image') argv.push('--out', outPath)
  const child = $.process.spawn({ argv, cwd: $.plugin.root })
  let rest = ''
  let frames = 0
  let status = 'exited'
  try {
    for await (const piece of child) {
      if (mine !== generation) break
      if (piece.stream === 'stderr') {
        status = piece.text.trim().slice(0, 200)
        continue
      }
      const split = splitLines(rest, piece.text)
      rest = split.rest
      let latestCells: string | null = null
      let latestPicture = 0
      for (const line of split.lines) {
        if (line.startsWith('F ')) latestCells = line.slice(2)
        else if (line.startsWith('I ')) latestPicture = Number(line.slice(2))
        else if (line.startsWith('L ')) status = line.slice(2)
      }
      if (latestCells !== null) {
        frame = latestCells
        frames++
        void $.ui.blit({ requestId: PANE, key: 'screen', cells: latestCells }).catch(() => undefined)
      }
      if (latestPicture > 0) {
        frames++
        const isStillImage = await showPicture($, shape, latestPicture)
        if (!isStillImage) return
      }
      const isCheckpoint = (latestCells !== null || latestPicture > 0) && (frames === 1 || frames % 200 === 0)
      if (isCheckpoint) {
        await update($, screen, held => ({
          ...held,
          frames,
          status: held.status.startsWith('starting') ? 'running' : held.status,
          picture: held.picture === null ? null : { ...held.picture, generation: latestPicture },
        }))
      }
    }
  } catch (error) {
    status = error instanceof Error ? error.message : String(error)
  }
  if (mine !== generation) return
  await update($, screen, held => ({ ...held, isRunning: false, status: `stopped: ${status}` }))
}

const launch = async ($: EngineInterface, shape: Shape, display: Display): Promise<void> => {
  generation++
  const mine = generation
  keys = emptyLog()
  frame = null
  imageDenies = 0
  const dir = await scratchDir($)
  const stamp = Math.floor(await $.clock.now())
  keysPath = `${dir}/slop-doom-${stamp}.keys`
  outPath = `${dir}/slop-doom-${stamp}.rgb`
  await writeKeys($)
  runner = await pickRunner($)
  const picture = display === 'image' ? { file: outPath, width: NATIVE_WIDTH, height: NATIVE_HEIGHT, generation: 0 } : null
  await update($, screen, () => ({ isRunning: true, display, picture, columns: shape.columns, rows: shape.rows, status: `starting with ${runner}`, frames: 0 }))
  startReleasing($)
  void pump($, shape, display, mine)
}

const halt = async ($: EngineInterface): Promise<void> => {
  generation++
  keys = releaseAll(keys)
  await writeKeys($)
  releaseTimer?.cancel()
  releaseTimer = null
  frame = null
  await update($, screen, held => ({ ...held, isRunning: false, status: 'closed' }))
}

const draw = async ($: EngineInterface, e: ResolveInput) => {
  const s = await read($, screen)
  if (e.surface !== 'terminal') {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box paddingX={1}>
        <Text dimColor>Slop Doom draws into a terminal; this surface has no Raster or Image.</Text>
      </Box>
    )
  }
  const { Box, Button, Image, Raster, Text } = $.ui.resolve(e)
  const shape = { columns: s.columns, rows: s.rows }
  const strip = (controls: readonly Control[]) => controls.map(c => <Button key={c.key} hotkey={c.hotkey} plain onPress={() => tap($, c)}>{c.label}</Button>)
  const picture = s.display === 'image' && s.picture !== null
    ? <Image key="screen" source={{ file: s.picture.file, format: 'rgb', width: s.picture.width, height: s.picture.height, generation: s.picture.generation }} columns={shape.columns} rows={shape.rows} alt="DOOM" />
    : <Raster key="screen" columns={shape.columns} rows={shape.rows} cells={frame !== null && frame.length === cellsLength(shape) ? frame : blankCells(shape)} />
  return (
    <Box flexDirection="column" paddingX={1}>
      {picture}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {strip(CONTROLS)}
      </Box>
      <Box flexDirection="row" columnGap={1}>
        {strip(WEAPONS)}
        <Text dimColor>  {s.status}</Text>
      </Box>
    </Box>
  )
}

type Ask = { readonly columns?: number; readonly fps?: number; readonly display?: Display; readonly isClose: boolean; readonly isBad: boolean }

const parseAsk = (args: string): Ask => {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  let ask: Ask = { isClose: false, isBad: false }
  for (const word of words) {
    if (word === 'close') return { isClose: true, isBad: false }
    const display = parseDisplay(word)
    if (display !== undefined) {
      ask = { ...ask, display }
      continue
    }
    const n = Number(word)
    if (!Number.isFinite(n)) return { isClose: false, isBad: true }
    ask = ask.columns === undefined ? { ...ask, columns: n } : { ...ask, fps: n }
  }
  return ask
}

export const register: Register = (on, options) => {
  fps = clampFps(typeof options.fps === 'number' ? options.fps : 15)
  filter = options.filter === 'box' || options.filter === 'nearest' ? options.filter : 'mode'
  blocks = options.blocks === 'half' ? 'half' : 'quad'
  cellAspect = clampCellAspect(typeof options.cell === 'number' ? options.cell : DEFAULT_CELL_ASPECT)
  configDisplay = options.display === 'image' || options.display === 'cells' ? options.display : 'auto'

  on('session.start', async ($, e, next) => {
    await update($, screen, () => idleScreen())
    await $.command.register({
      name: 'doom',
      description: 'Slop Doom: play DOOM in a pane, or close it',
      argumentHint: '[columns [fps]] [image|cells] | close',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'doom' }, async ($, e) => {
    const ask = parseAsk(e.args)
    if (ask.isClose) {
      await halt($)
      await $.ui.close({ id: PANE })
      return { text: 'Doom closed.' }
    }
    if (ask.isBad) return { text: 'Usage: /doom [columns [fps]] [image|cells] | close' }
    if (ask.fps !== undefined) fps = clampFps(ask.fps)
    const display = ask.display ?? await pickDisplayHere($)
    const shape = shapeFor(ask.columns ?? autoColumns(e.presentation.columns, terminalRows, cellAspect), display, cellAspect)
    const opened = await $.ui.open({ id: PANE, title: 'Slop Doom', focus: true, rows: shape.rows + 4, columns: shape.columns + 4 })
    if (!opened.isPlaced) return { text: 'Doom is waiting for a wider terminal.' }
    const s = await read($, screen)
    if (!s.isRunning || s.columns !== shape.columns || s.display !== display || ask.fps !== undefined) {
      await halt($)
      await launch($, shape, display)
    }
    const size = display === 'image' ? `${NATIVE_WIDTH}x${NATIVE_HEIGHT} pixels over ${shape.columns}x${shape.rows} cells` : `${shape.columns * (blocks === 'quad' ? 2 : 1)}x${shape.rows * 2} in ${shape.columns}x${shape.rows} cells`
    return { text: `Doom is up at ${size}, ${fps} fps. w/s move, a/d turn, q/e strafe, f fire, u use, n enter, x menu. Esc hands the keys back.` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await halt($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    terminalRows = e.viewport?.rows ?? terminalRows
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    terminalRows = e.viewport?.rows ?? terminalRows
    return draw($, e)
  })
}
