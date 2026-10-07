import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { DoomScreen } from '../types'
import { CONTROLS, WEAPONS, autoColumns, blankCells, cellsLength, clampFps, emptyLog, press, releaseAll, releaseDue, serialize, shapeFor, splitLines } from './wire'
import type { Control, KeyLog, Shape } from './wire'

const PANE = 'slop-doom'
const RELEASE_TICK_MS = 40

const idleScreen = (): DoomScreen => ({ isRunning: false, columns: 80, rows: 24, status: 'idle', frames: 0 })

const screen = atom({ plugin: 'slop-doom', key: 'screen' } as const, idleScreen())

let fps = 15
let frame: string | null = null
let keys: KeyLog = emptyLog()
let keysPath = ''
let runner = 'bun'
let generation = 0
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

const pump = async ($: EngineInterface, shape: Shape, mine: number): Promise<void> => {
  const argv = [runner, `${$.plugin.root}/sidecar/doom.ts`, '--keys', keysPath, '--cols', String(shape.columns), '--rows', String(shape.rows), '--fps', String(fps)]
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
      let latest: string | null = null
      for (const line of split.lines) {
        if (line.startsWith('F ')) latest = line.slice(2)
        else if (line.startsWith('L ')) status = line.slice(2)
      }
      if (latest !== null) {
        frame = latest
        frames++
        void $.ui.blit({ requestId: PANE, key: 'screen', cells: latest }).catch(() => undefined)
        if (frames === 1 || frames % 200 === 0) await update($, screen, held => ({ ...held, frames, status: 'running' }))
      }
    }
  } catch (error) {
    status = error instanceof Error ? error.message : String(error)
  }
  if (mine !== generation) return
  await update($, screen, held => ({ ...held, isRunning: false, status: `stopped: ${status}` }))
}

const launch = async ($: EngineInterface, shape: Shape): Promise<void> => {
  generation++
  const mine = generation
  keys = emptyLog()
  frame = null
  keysPath = `/tmp/slop-doom-${Math.floor(await $.clock.now())}.keys`
  await writeKeys($)
  runner = await pickRunner($)
  await update($, screen, () => ({ isRunning: true, columns: shape.columns, rows: shape.rows, status: `starting with ${runner}`, frames: 0 }))
  startReleasing($)
  void pump($, shape, mine)
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
        <Text dimColor>Slop Doom draws into a terminal Raster; this surface has none.</Text>
      </Box>
    )
  }
  const { Box, Button, Raster, Text } = $.ui.resolve(e)
  const shape = { columns: s.columns, rows: s.rows }
  const strip = (controls: readonly Control[]) => controls.map(c => <Button key={c.key} hotkey={c.hotkey} plain onPress={() => tap($, c)}>{c.label}</Button>)
  return (
    <Box flexDirection="column" paddingX={1}>
      <Raster key="screen" columns={shape.columns} rows={shape.rows} cells={frame !== null && frame.length === cellsLength(shape) ? frame : blankCells(shape)} />
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

export const register: Register = (on, options) => {
  fps = clampFps(typeof options.fps === 'number' ? options.fps : 15)

  on('session.start', async ($, e, next) => {
    await update($, screen, () => idleScreen())
    await $.command.register({
      name: 'doom',
      description: 'Slop Doom: play DOOM in a pane, or close it',
      argumentHint: '[columns [fps]] | close',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'doom' }, async ($, e) => {
    const [verb = '', rate] = e.args.trim().split(/\s+/)
    if (verb === 'close') {
      await halt($)
      await $.ui.close({ id: PANE })
      return { text: 'Doom closed.' }
    }
    const columns = verb === '' ? autoColumns(e.presentation.columns) : Number(verb)
    if (!Number.isFinite(columns)) return { text: 'Usage: /doom [columns [fps] | close]' }
    if (rate !== undefined) fps = clampFps(Number(rate))
    const shape = shapeFor(columns)
    const opened = await $.ui.open({ id: PANE, title: 'Slop Doom', focus: true, rows: shape.rows + 4, columns: shape.columns + 4 })
    if (!opened.isPlaced) return { text: 'Doom is waiting for a wider terminal.' }
    const s = await read($, screen)
    if (!s.isRunning || s.columns !== shape.columns || rate !== undefined) {
      await halt($)
      await launch($, shape)
    }
    return { text: `Doom is up at ${shape.columns}x${shape.rows * 2}, ${fps} fps. w/s move, a/d turn, q/e strafe, f fire, u use, n enter, x menu. Esc hands the keys back.` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await halt($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => draw($, e))
}
