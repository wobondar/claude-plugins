import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { TetrisCommand, TetrisGame, TetrisLive } from '../types'

const PANE = 'slop-tetris'
const PANE_ROWS = 24
const PANE_COLUMNS = 48

const idleLive = (): TetrisLive => ({ isOpen: false, phase: 'idle', score: 0, lines: 0, level: 1, pieces: 0 })

const live = atom({ plugin: 'slop-tetris', key: 'live' } as const, idleLive())
const lastGame = atom({ plugin: 'slop-tetris', key: 'lastGame' } as const, null as TetrisGame | null)
const highScore = atom({ plugin: 'slop-tetris', key: 'highScore' } as const, 0)
const command = atom({ plugin: 'slop-tetris', key: 'command' } as const, { seq: 0, action: 'pause' } as TetrisCommand)

type Control = { readonly key: string; readonly hotkey: string; readonly label: string; readonly action: TetrisCommand['action'] }

const CONTROLS: readonly Control[] = [
  { key: 'left', hotkey: 'a', label: '←', action: 'left' },
  { key: 'right', hotkey: 'd', label: '→', action: 'right' },
  { key: 'cw', hotkey: 'w', label: 'spin', action: 'cw' },
  { key: 'soft', hotkey: 's', label: '↓', action: 'soft' },
  { key: 'hard', hotkey: 'f', label: 'drop', action: 'hard' },
  { key: 'hold', hotkey: 'c', label: 'hold', action: 'hold' },
  { key: 'pause', hotkey: 'p', label: 'pause', action: 'pause' },
  { key: 'new', hotkey: 'r', label: 'new', action: 'new' },
]

const send = ($: EngineInterface, action: TetrisCommand['action']) => (): Promise<TetrisCommand> =>
  update($, command, held => ({ seq: held.seq + 1, action }))

type Summary = {
  kind: 'tick' | 'gameOver'
  score: number
  lines: number
  level: number
  pieces: number
  phase: 'playing' | 'paused' | 'over'
}

const isSummary = (data: unknown): data is Summary => {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    (d.kind === 'tick' || d.kind === 'gameOver') &&
    typeof d.score === 'number' && typeof d.lines === 'number' && typeof d.level === 'number' && typeof d.pieces === 'number' &&
    (d.phase === 'playing' || d.phase === 'paused' || d.phase === 'over')
  )
}

const loadBest = async ($: EngineInterface): Promise<number> => {
  const stored = await $.store.get('highScore')
  const best = typeof stored === 'number' ? stored : 0
  await update($, highScore, () => best)
  return best
}

const seedFrom = async ($: EngineInterface): Promise<number> => (Math.floor(await $.clock.now()) ^ 0x5bd1e995) >>> 0

const draw = async ($: EngineInterface, e: ResolveInput) => {
  const best = await read($, highScore)
  if (e.surface !== 'terminal' && e.surface !== 'desktop') {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Slop Tetris</Text>
        <Text dimColor>Runs in the terminal and the desktop app. Best so far: {best.toLocaleString('en-US')}.</Text>
      </Box>
    )
  }
  const { Box, Button, Client } = $.ui.resolve(e)
  const seed = await seedFrom($)
  const pending = await read($, command)
  return (
    <Box flexDirection="column" paddingX={1}>
      <Client key="game" module="./game.tsx" props={{ seed, highScore: best, command: pending }} width={44} height={22} />
      <Box flexDirection="row" columnGap={1}>
        {CONTROLS.map(c => <Button key={c.key} hotkey={c.hotkey} plain onPress={send($, c.action)}>{c.label}</Button>)}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadBest($)
    await update($, live, () => idleLive())
    await $.command.register({
      name: 'tetris',
      description: 'Slop Tetris: open the game in a pane, or close it',
      argumentHint: '[close]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'tetris' }, async ($, e) => {
    const verb = e.args.trim()
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      await update($, live, held => ({ ...held, isOpen: false }))
      return { text: 'Tetris closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Slop Tetris', focus: true, rows: PANE_ROWS, columns: PANE_COLUMNS })
    if (!opened.isPlaced) return { text: 'Tetris is waiting for a wider terminal.' }
    await update($, live, held => ({ ...held, isOpen: true }))
    return { text: 'Tetris is up. a/d move, w spins, s/f drop, c holds, p pauses, r restarts. Esc hands the keys back to the prompt.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, live, held => ({ ...held, isOpen: false }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => draw($, e))

  on('ui.message', async ($, e, next) => {
    const data = e.data
    if (!isSummary(data)) return next(e)
    await update($, live, held => ({
      ...held,
      phase: data.phase,
      score: data.score,
      lines: data.lines,
      level: data.level,
      pieces: data.pieces,
    }))
    let best = await read($, highScore)
    if (data.kind === 'gameOver') {
      const endedAt = Math.floor(await $.clock.now())
      await update($, lastGame, () => ({ score: data.score, lines: data.lines, level: data.level, pieces: data.pieces, endedAt }))
      if (data.score > best) {
        best = data.score
        await update($, highScore, () => best)
        await $.store.set('highScore', best)
      }
    }
    await next(e)
    return { props: { seed: await seedFrom($), highScore: best, command: await read($, command) } }
  })
}
