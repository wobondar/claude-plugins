import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, ResolveInput } from 'claude-code'

import type { SlopHallOfFame, SlopHistoryEntry, SlopTally, SlopTurn, SlopWallet } from '../types'
import {
  BETS, CLD, COMBO_BONUS, COMBO_EVERY, SITES, SLOT, TOOL_PAY, YEET_BONUS,
  FRAME_MS, formatCld, frameAt, idleMachine, isLanding, judge, nextBet, planSpin, signedCld, spinLength, toastFrame, visibleSymbols,
} from './reels'
import type { Frame, MachineState, Outcome, Site, SpinPlan } from './reels'
import {
  FRAME_COLUMNS, FRAME_ROWS, TITLE, TITLE_COLUMNS, TITLE_CYCLE_MS, TITLE_FRAME_MS, packCells, readoutFor, renderFrame, renderTitle, textReels,
} from './raster'
const MARQUEE_MS = 400

const initialWallet = (balance: number): SlopWallet => ({
  balance,
  bet: BETS[0] as number,
  fromPrompts: 0,
  fromTools: 0,
  fromSpins: 0,
  wagered: 0,
  won: 0,
  spins: 0,
  biggestWin: 0,
})

const idleTurn = (): SlopTurn => ({ isWorking: false, tools: 0, combos: 0, spins: 0, spinsNet: 0, startedAt: 0 })

const emptyHall = (): SlopHallOfFame => ({
  lifetimeNet: 0,
  lifetimeSpins: 0,
  biggestWin: 0,
  jackpots: 0,
  typeErrors: 0,
  sessions: 0,
})

const wallet = atom({ plugin: 'slop-machine', key: 'wallet' } as const, initialWallet(100))
const turn = atom({ plugin: 'slop-machine', key: 'turn' } as const, idleTurn())
const tallies = atom({ plugin: 'slop-machine', key: 'tallies' } as const, {})
const history = atom({ plugin: 'slop-machine', key: 'history' } as const, [])
const marquee = atom({ plugin: 'slop-machine', key: 'marquee' } as const, 0)
const isHidden = atom({ plugin: 'slop-machine', key: 'isHidden' } as const, false)
const machine = atom({ plugin: 'slop-machine', key: 'machine' } as const, idleMachine())

type Settings = { sounds: boolean; announcer: boolean; startingBalance: number }

let settings: Settings = { sounds: true, announcer: true, startingBalance: 100 }

const isMuted = atom({ plugin: 'slop-machine', key: 'isMuted' } as const, false)

type LiveSpin = { plan: SpinPlan; tick: number; frame: Frame }

let live: LiveSpin | null = null
let bandRequestId: string | null = null
let titleTick = 0
let titleTimer: { cancel: () => void } | null = null
let flashUntilTick = 0

const titlePhase = (): number => ((titleTick * TITLE_FRAME_MS) / TITLE_CYCLE_MS) % 1

const titleCells = (): string => packCells(renderTitle(titlePhase(), { chaser: titleTick, isFlashing: titleTick < flashUntilTick }))

const flashTitle = (ms: number): void => {
  flashUntilTick = titleTick + Math.ceil(ms / TITLE_FRAME_MS)
}

const liveView = (m: MachineState): MachineState => (live === null ? m : { ...m, phase: 'spinning', reels: live.frame.reels, stopped: live.frame.stopped })

const blitMachine = async ($: EngineInterface, m: MachineState, bet: number, lit: number): Promise<void> => {
  if (bandRequestId === null) return
  const { readout, color } = readoutFor(m, bet, '1 to spin')
  await $.ui.blit({ requestId: bandRequestId, key: 'band', cells: packCells(renderFrame(m, { lit, readout, readoutColor: color })) })
}

const startTitle = ($: EngineInterface): void => {
  titleTimer?.cancel()
  titleTimer = $.clock.every(TITLE_FRAME_MS, () => {
    titleTick += 1
    if (bandRequestId === null) return
    void $.ui.blit({ requestId: bandRequestId, key: 'title', cells: titleCells() })
  })
}

const formatDuration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s - m * 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m - h * 60}m`
}

const formatClock = (ms: number): string => {
  const d = new Date(ms)
  try {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    const h = d.getHours()
    const minute = String(d.getMinutes()).padStart(2, '0')
    return `${h % 12 === 0 ? 12 : h % 12}:${minute} ${h < 12 ? 'AM' : 'PM'}`
  }
}

const toggleMute = async ($: EngineInterface): Promise<void> => {
  const muted = await update($, isMuted, held => !held)
  await $.store.set('isMuted', muted)
  $.ui.toast(muted ? `${SLOT} muted` : `${SLOT} unmuted`, { timeoutMs: 2000 })
}
const timers: Partial<Record<Site, { cancel: () => void }>> = {}
let marqueeTimer: { cancel: () => void } | null = null

const play = async ($: EngineInterface, name: 'spin' | 'win' | 'jackpot' | 'lose'): Promise<void> => {
  if (!settings.sounds || (await read($, isMuted))) return
  $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

const say = async ($: EngineInterface, text: string): Promise<void> => {
  if (!settings.announcer || (await read($, isMuted))) return
  $.audio.speak(text).catch(() => undefined)
}

let hall: SlopHallOfFame = emptyHall()

const loadHall = async ($: EngineInterface): Promise<SlopHallOfFame> => {
  hall = ((await $.store.get('hall')) as SlopHallOfFame | undefined) ?? emptyHall()
  return hall
}

let hallChain: Promise<unknown> = Promise.resolve()

const hallUpdate = ($: EngineInterface, change: (hall: SlopHallOfFame) => SlopHallOfFame): Promise<SlopHallOfFame> => {
  const step = async (): Promise<SlopHallOfFame> => {
    hall = change(await loadHall($))
    await $.store.set('hall', hall)
    return hall
  }
  const run = hallChain.then(step, step)
  hallChain = run
  return run
}

const settle = async ($: EngineInterface, site: Site, m: MachineState, bet: number, rng: () => number): Promise<Outcome> => {
  const outcome = judge(visibleSymbols(m), bet, rng)
  await update($, memberOf(machine, { requestId: site }), held => ({ ...held, phase: 'result' as const, outcome, spins: held.spins + 1 }))
  const w = await update($, wallet, held => ({
    ...held,
    balance: held.balance + outcome.payout,
    won: held.won + Math.max(0, outcome.payout),
    fromSpins: held.fromSpins + outcome.payout,
    biggestWin: Math.max(held.biggestWin, outcome.payout),
  }))
  await update($, turn, held => ({ ...held, spinsNet: held.spinsNet + outcome.payout }))
  const at = await $.clock.now()
  await update($, history, held => [{ site, outcome, bet, at } satisfies SlopHistoryEntry, ...held].slice(0, 30))
  void hallUpdate($, hall => ({
    ...hall,
    lifetimeNet: hall.lifetimeNet + outcome.payout - bet,
    lifetimeSpins: hall.lifetimeSpins + 1,
    biggestWin: Math.max(hall.biggestWin, outcome.payout),
    jackpots: hall.jackpots + (outcome.tier === 'jackpot' ? 1 : 0),
    typeErrors: hall.typeErrors + (outcome.tier === 'cursed' ? 1 : 0),
  }))

  const line = `${toastFrame({ ...m, stopped: [true, true, true] })} ${outcome.title} ${outcome.payout === 0 ? '' : signedCld(outcome.payout)} ${CLD} · balance ${formatCld(w.balance)} ${CLD}`
  if (outcome.tier === 'jackpot' || outcome.tier === 'big') flashTitle(outcome.tier === 'jackpot' ? 8000 : 3000)
  if (outcome.tier === 'jackpot') {
    void play($, 'jackpot')
    void say($, `Jackpot. ${outcome.payout} Claude dollars.`)
    $.ui.toast(`💥 ${line}`, { timeoutMs: 10000 })
  } else if (outcome.tier === 'cursed') {
    void play($, 'lose')
    void say($, 'any. any. any. Your TypeScript license has been revoked.')
    $.ui.toast(`☠️ ${line}`, { timeoutMs: 8000 })
  } else if (outcome.tier === 'big') {
    void play($, 'win')
    $.ui.toast(`✨ ${line}`, { timeoutMs: 6000 })
  } else if (outcome.payout > 0) {
    void play($, 'win')
  }
  return outcome
}

const spin = async ($: EngineInterface, site: Site, rng: () => number = Math.random): Promise<void> => {
  if (live !== null) return
  const m = await read($, memberOf(machine, { requestId: site }))
  const w = await read($, wallet)
  const bet = w.bet
  const plan: SpinPlan = planSpin(rng)
  const start = [m.reels[0].index, m.reels[1].index, m.reels[2].index] as const
  live = { plan, tick: 0, frame: frameAt(start, plan, 0) }

  await update($, wallet, held => ({
    ...held,
    balance: held.balance - bet,
    wagered: held.wagered + bet,
    spins: held.spins + 1,
    fromSpins: held.fromSpins - bet,
  }))
  await update($, turn, held => ({ ...held, spins: held.spins + 1, spinsNet: held.spinsNet - bet }))
  await update($, memberOf(machine, { requestId: site }), held => ({ ...held, phase: 'spinning' as const, stopped: [false, false, false] as [boolean, boolean, boolean], outcome: null }))
  void play($, 'spin')

  let chain: Promise<void> = Promise.resolve()
  const step = async (): Promise<void> => {
    if (live === null) return
    live.tick += 1
    live.frame = frameAt(start, plan, live.tick)
    const { tick, frame } = live
    const shown: MachineState = { ...m, phase: 'spinning', reels: frame.reels, stopped: frame.stopped, outcome: null }
    if (tick >= spinLength(plan)) {
      timer.cancel()
      delete timers[site]
      live = null
      const landed = await update($, memberOf(machine, { requestId: site }), held => ({ ...held, reels: frame.reels, stopped: frame.stopped }))
      await settle($, site, landed, bet, rng)
      return
    }
    if (isLanding(plan, tick)) {
      await update($, memberOf(machine, { requestId: site }), held => ({ ...held, reels: frame.reels, stopped: frame.stopped }))
      return
    }
    await blitMachine($, shown, bet, Math.floor(tick / 4))
  }
  const timer = $.clock.every(FRAME_MS, () => {
    chain = chain.then(step, step)
  })
  timers[site] = timer
}

const cycleBet = async ($: EngineInterface): Promise<void> => {
  const w = await update($, wallet, held => ({ ...held, bet: nextBet(held.bet) }))
  $.ui.toast(`${SLOT} bet is now ${w.bet} ${CLD}`, { timeoutMs: 2000 })
}

const startMarquee = ($: EngineInterface): void => {
  marqueeTimer?.cancel()
  marqueeTimer = $.clock.every(MARQUEE_MS, () => {
    void update($, marquee, n => (n + 1) % 1000)
  })
}

const stopMarquee = (): void => {
  marqueeTimer?.cancel()
  marqueeTimer = null
}

type MachineViewArgs = { site: Site; rasterKey: string; hint: string }

const machineView = async ($: EngineInterface, e: ResolveInput, { site, rasterKey, hint }: MachineViewArgs): Promise<RenderElement> => {
  const m = liveView(await read($, memberOf(machine, { requestId: site })))
  const w = await read($, wallet)
  const lit = (await read($, marquee)) + Math.floor((live?.tick ?? 0) / 4)
  const { readout, color } = readoutFor(m, w.bet, hint)
  if (e.surface === 'terminal') {
    const { Raster } = $.ui.resolve(e)
    return (
      <Raster
        key={rasterKey}
        columns={FRAME_COLUMNS}
        rows={FRAME_ROWS}
        cells={packCells(renderFrame(m, { lit, readout, readoutColor: color }))}
      />
    )
  }
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      <Text bold color="warning">{textReels(m).join('\n')}</Text>
      <Text dimColor>{readout}</Text>
    </Box>
  )
}

const historyLine = (entry: SlopHistoryEntry): string => {
  const reels = entry.outcome.symbols
    .map(s => (s === 'cherry' ? '🍒' : s === 'seven' ? '7' : s === 'coin' ? '$' : s === 'diamond' ? '◆' : s))
    .join(' ')
  return `${reels}  ${entry.outcome.title} ${entry.outcome.payout === 0 ? '' : signedCld(entry.outcome.payout)}`
}

export const register: Register = (on, options) => {
  settings = {
    sounds: options.sounds !== false,
    announcer: options.announcer !== false,
    startingBalance: typeof options.startingBalance === 'number' ? options.startingBalance : 100,
  }

  on('session.start', async ($, e, next) => {
    const w = await read($, wallet)
    if (w.balance === 100 && w.spins === 0 && w.fromPrompts === 0 && settings.startingBalance !== 100) {
      await update($, wallet, held => ({ ...held, balance: settings.startingBalance }))
    }
    for (const site of SITES) {
      const m = await read($, memberOf(machine, { requestId: site }))
      if (m.phase === 'spinning') await update($, memberOf(machine, { requestId: site }), held => ({ ...held, phase: 'idle' as const, stopped: [true, true, true] as [boolean, boolean, boolean] }))
    }
    await update($, turn, held => ({ ...held, isWorking: false }))
    const muted = (await $.store.get('isMuted')) === true
    await update($, isMuted, () => muted)
    await loadHall($)
    startTitle($)
    await $.command.register({
      name: 'slop',
      description: 'Slop Machine: stats, bet, reset, hide or show the band',
      argumentHint: '[stats | bet <n> | reset | hide | show]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'slop' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'bet') {
      const n = Number(arg)
      if (!Number.isInteger(n) || n <= 0) return { text: `Usage: /slop bet <n>. Presets: ${BETS.join(', ')}.` }
      await update($, wallet, held => ({ ...held, bet: n }))
      return { text: `Bet set to ${n} ${CLD}.` }
    }
    if (verb === 'reset') {
      await update($, wallet, () => initialWallet(settings.startingBalance))
      for (const site of SITES) await update($, memberOf(machine, { requestId: site }), () => idleMachine())
      await update($, history, () => [])
      return { text: `Wallet reset to ${settings.startingBalance} ${CLD}. The house thanks you for your business.` }
    }
    if (verb === 'hide') {
      await update($, isHidden, () => true)
      return { text: 'Slop machine band hidden. Press 0 at an empty prompt, or /slop show, to bring it back.' }
    }
    if (verb === 'show') {
      await update($, isHidden, () => false)
      return { text: 'Slop machine band shown.' }
    }
    if (verb === 'stats' || verb === undefined || verb === '') {
      const w = await read($, wallet)
      const rtp = w.wagered > 0 ? `${Math.round((w.won / w.wagered) * 100)}%` : 'n/a'
      return {
        text: [
          `**Session** balance ${formatCld(w.balance)} ${CLD} · bet ${w.bet}`,
          `prompts +${formatCld(w.fromPrompts)} · tools +${formatCld(w.fromTools)} · spins ${signedCld(w.fromSpins)} (${w.spins} spins, RTP ${rtp}, best +${formatCld(w.biggestWin)})`,
          `**Lifetime** net ${signedCld(hall.lifetimeNet)} over ${hall.lifetimeSpins} spins · best +${formatCld(hall.biggestWin)} · jackpots ${hall.jackpots} · type errors ${hall.typeErrors}`,
        ].join('\n'),
      }
    }
    return { text: 'Usage: /slop [stats | bet <n> | reset | hide | show]' }
  })

  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (entered.drop !== undefined) return entered
    if (e.origin.kind === 'plugin') return entered
    const chars = [...e.text].length
    const yeet = /\byeet\b/i.test(e.text) ? YEET_BONUS : 0
    const w = await update($, wallet, held => ({
      ...held,
      balance: held.balance + chars + yeet,
      fromPrompts: held.fromPrompts + chars + yeet,
    }))
    if (yeet > 0) $.ui.toast(`${SLOT} YEET BONUS +${YEET_BONUS} ${CLD}`, { timeoutMs: 4000 })
    return entered
  })

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, turn, () => ({ isWorking: true, tools: 0, combos: 0, spins: 0, spinsNet: 0, startedAt }))
    startMarquee($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, turn, held => {
      const tools = held.tools + 1
      return { ...held, tools, combos: Math.floor(tools / COMBO_EVERY) }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    stopMarquee()
    const t = await read($, turn)
    const toolPay = t.tools * TOOL_PAY
    const comboPay = t.combos * COMBO_BONUS
    const w = await update($, wallet, held => ({
      ...held,
      balance: held.balance + toolPay + comboPay,
      fromTools: held.fromTools + toolPay + comboPay,
    }))
    const tally: SlopTally = {
      tools: t.tools,
      toolPay,
      comboPay,
      spins: t.spins,
      spinsNet: t.spinsNet,
      net: toolPay + comboPay + t.spinsNet,
      durationMs: e.durationMs,
      endedAt: await $.clock.now(),
      balance: w.balance,
    }
    await update($, tallies, held => Object.fromEntries([...Object.entries(held).slice(-49), [String(e.durationMs), tally]]))
    await update($, turn, held => ({ ...held, isWorking: false }))
    if (t.tools > 0 || t.spins > 0) {
      $.ui.toast(`${SLOT} we earned ${signedCld(tally.net)} ${CLD} this turn · balance ${formatCld(w.balance)} ${CLD}`, { timeoutMs: 6000 })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const w = await read($, wallet)
    bandRequestId = e.requestId
    if (await read($, isHidden)) {
      return (
        <Box gap={2} paddingLeft={2} paddingTop={1}>
          <Text dimColor>
            {SLOT} {CLD} {formatCld(w.balance)}
          </Text>
          <Button key="show" hotkey="0" plain dimColor onPress={() => update($, isHidden, () => false)}>
            show slop machine
          </Button>
        </Box>
      )
    }
    const recent = (await read($, history)).slice(0, 2)
    const muted = await read($, isMuted)
    const balanceColor = w.balance < 0 ? 'error' : 'success'
    const rtp = w.wagered > 0 ? `${Math.round((w.won / w.wagered) * 100)}%` : 'n/a'

    return (
      <Box gap={2} paddingLeft={2} paddingTop={1}>
        {await machineView($, e, { site: 'band', rasterKey: 'band', hint: '1 to spin' })}
        <Box flexDirection="column">
          <Box gap={1}>
            {e.surface === 'terminal'
              ? (() => {
                  const { Raster } = $.ui.resolve(e)
                  return <Raster key="title" columns={TITLE_COLUMNS} rows={1} cells={titleCells()} />
                })()
              : <Text bold color="claude">{TITLE.trim()}</Text>}
            <Text bold color={balanceColor}>
              {CLD} {formatCld(w.balance)}
            </Text>
            {w.balance < 0 && <Text color="error" italic>(Claude Credit)</Text>}
            <Text bold color="white">
              {' '}&lt; bet {formatCld(w.bet)} &gt;
            </Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            prompts +{formatCld(w.fromPrompts)} · tools +{formatCld(w.fromTools)} · spins {signedCld(w.fromSpins)}
          </Text>
          <Text dimColor wrap="truncate-end">
            {w.spins} spins · wagered {formatCld(w.wagered)} · won {formatCld(w.won)} · RTP {rtp} · best +{formatCld(w.biggestWin)}
          </Text>
          <Text dimColor wrap="truncate-end">
            lifetime {signedCld(hall.lifetimeNet)} over {hall.lifetimeSpins} spins · jackpots {hall.jackpots} · type errors {hall.typeErrors}
          </Text>
          <Box gap={1}>
            <Button key="spin" hotkey="1" variant="primary" label="1: spin" onPress={() => spin($, 'band')} />
            <Button key="bet" hotkey="2" label="2: bet" onPress={() => cycleBet($)} />
            <Button key="mute" hotkey="8" label={muted ? '8: unmute' : '8: mute'} onPress={() => toggleMute($)} />
            <Button key="hide" hotkey="0" label="0: hide" onPress={() => update($, isHidden, () => true)} />
          </Box>
          {recent.length === 0 && <Text dimColor>the reels are cold. 1 to spin at an empty prompt.</Text>}
          {recent.map(entry => (
            <Text dimColor wrap="truncate-end">{historyLine(entry)}</Text>
          ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, turn)
    const w = await read($, wallet)
    const pending = t.tools * TOOL_PAY + t.combos * COMBO_BONUS
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>
          {'  '}{SLOT} Claude {t.tools} tool calls → +{formatCld(pending)} {CLD} pending · you {signedCld(t.spinsNet)} · balance {formatCld(w.balance)} {CLD}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const tally = (await read($, tallies))[String(e.props.durationMs)]
    if (tally === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const you = tally.spins > 0 ? `, you ${tally.spins} spins ${signedCld(tally.spinsNet)}` : ''
    const done = tally.endedAt === undefined ? '' : ` · done ${formatClock(tally.endedAt)}`
    return (
      <Box marginTop={1}>
        <Text dimColor>
          ✻ {e.props.word} for {formatDuration(e.props.durationMs)}{done} · {SLOT} {signedCld(tally.net)} {CLD} (Claude {tally.tools} tools +{formatCld(tally.toolPay + tally.comboPay)}{you})
        </Text>
      </Box>
    )
  })
}
