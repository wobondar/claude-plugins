import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { SlopMachine, SlopTurn, SlopWallet } from '../types'

const PLUGIN = 'slop-machine'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

const SPINNER = {
  component: 'Spinner',
  props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
} as const

type Seen = { toasts: string[]; status: string[]; logs: string[]; spoken: string[]; played: string[]; opened: Array<{ id: string; focus?: true }>; blits: string[]; state: Record<string, unknown> }

type WorldOptions = { drop?: boolean; now?: number }

const world = (on: On, { drop = false, now = 1000 }: WorldOptions = {}) => {
  const seen: Seen = { toasts: [], status: [], logs: [], spoken: [], played: [], opened: [], blits: [], state: {} }
  mock.store(on)
  const clock = mock.clock(on, { now })
  on('state.set', ($, e, next) => {
    seen.state[e.id === undefined ? e.key : `${e.key}/${e.id}`] = e.value
    return next(e)
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    if (e.text !== undefined) seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    seen.opened.push({ id: e.id, focus: e.focus })
    return { value: { isPlaced: true as const } }
  })
  on('ui.blit', ($, e) => {
    seen.blits.push(e.key)
    return { value: {} }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('audio.play', ($, e) => {
    seen.played.push(e.clip.asset ?? 'inline')
    return { value: undefined }
  })
  on('audio.speak', ($, e) => {
    seen.spoken.push(e.text)
    return { value: { via: 'system' as const } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => (drop ? { drop: 'no' } : { text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, isImage: false } }))
  return { seen, clock }
}

const wallet = (seen: Seen): SlopWallet => seen.state.wallet as SlopWallet
const turnState = (seen: Seen): SlopTurn => seen.state.turn as SlopTurn
const machineAt = (seen: Seen, site: string): SlopMachine => seen.state[`machine/${site}`] as SlopMachine

const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

describe('earning', () => {
  test('every character of a prompt is one Claude dollar, paid once the prompt entered', async ($, on) => {
    const { seen } = world(on)
    await submit($, 'hello world')
    const w = wallet(seen)
    expect(w.balance).toBe(100 + 11)
    expect(w.fromPrompts).toBe(11)
  })

  test('a dropped prompt pays nothing', async ($, on) => {
    const { seen } = world(on, { drop: true })
    await submit($, 'hello world')
    expect(seen.state.wallet).toBeUndefined()
  })

  test('yeet pays a bonus', async ($, on) => {
    const { seen } = world(on)
    await submit($, 'yeet it')
    expect(wallet(seen).fromPrompts).toBe(7 + 100)
    expect(seen.toasts.some(t => t.includes('YEET'))).toBe(true)
  })

  test('tool calls are counted during the turn and paid at turn.complete, with a combo every tenth', async ($, on) => {
    const { seen } = world(on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(turnState(seen).isWorking).toBe(true)
    for (let i = 0; i < 10; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(turnState(seen).tools).toBe(10)
    expect(turnState(seen).combos).toBe(1)
    expect(seen.state.wallet).toBeUndefined()

    await $.turn.complete({ answer: 'done', durationMs: 4321, isAborted: false, turnId: 't1', reason: 'answer' })
    const w = wallet(seen)
    expect(w.fromTools).toBe(10 * 10 + 100)
    expect(w.balance).toBe(100 + 200)
    expect(turnState(seen).isWorking).toBe(false)
    expect(seen.toasts.at(-1)).toContain('+200')
  })

  test("a subagent's turn.complete pays nothing", async ($, on) => {
    const { seen } = world(on)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'a1' })
    expect(seen.state.wallet).toBeUndefined()
    expect(turnState(seen).isWorking).toBe(true)
  })
})

describe('band', () => {
  test('the band draws the machine, the wallet, the stats and the hotkeys on terminal and desktop', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
      const buttons = await ui.findAll({ type: 'Button' })
      const hotkeys = buttons.map(b => b.props.hotkey)
      expect(hotkeys).toEqual(expect.arrayContaining(['1', '2', '8', '0']))
      expect(hotkeys).toHaveLength(4)
      expect((await ui.find({ type: 'Button', key: 'spin' }))?.props.label).toBe('1: spin')
      expect(await ui.find({ type: 'Text', text: /< bet 25 >/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /lifetime \+0 over 0 spins/ })).toBeDefined()
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster', key: 'band' })).toBeDefined()
        expect(await ui.find({ type: 'Raster', key: 'title' })).toBeDefined()
      } else {
        expect(await ui.find({ type: 'Raster' })).toBeUndefined()
        expect(await ui.find({ type: 'Text', text: /\[/ })).toBeDefined()
      }
      if (surface === 'desktop') expect(await ui.find({ type: 'Text', text: /SLOP MACHINE/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the band yields to a survey', async ($, on) => {
    world(on)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>survey</Text>
    })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'survey' })).toBeDefined()
  })

  test('hide collapses the band to the balance and 0 brings it back', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    await ui.press({ key: 'hide' })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'show' }))?.props.hotkey).toBe('0')
    await ui.press({ key: 'show' })
    expect(await ui.find({ type: 'Raster', key: 'band' })).toBeDefined()
  })

  test('pressing 1 takes the bet, spins the band machine and settles it on the clock', async ($, on) => {
    const { seen, clock } = world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    await ui.press({ key: 'spin' })
    let w = wallet(seen)
    expect(w.balance).toBe(75)
    expect(w.wagered).toBe(25)
    expect(machineAt(seen, 'band').phase).toBe('spinning')
    expect(seen.played).toContain('sounds/spin.wav')

    await ui.press({ key: 'spin' })
    expect(wallet(seen).wagered).toBe(25)

    await clock.advance(33 * 80)
    expect(seen.blits.filter(k => k === 'band').length).toBeGreaterThan(50)
    const m = machineAt(seen, 'band')
    expect(m.phase).toBe('result')
    expect(m.stopped).toEqual([true, true, true])
    expect(m.outcome).not.toBeNull()
    w = wallet(seen)
    expect(w.balance).toBe(75 + (m.outcome?.payout ?? 0))
    expect(w.spins).toBe(1)
    expect(turnState(seen).spinsNet).toBe(-25 + (m.outcome?.payout ?? 0))
    expect(await ui.find({ type: 'Text', text: new RegExp(m.outcome?.title ?? 'x') })).toBeDefined()
  })

  test('bet cycles through the presets', async ($, on) => {
    const { seen } = world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    await ui.press({ key: 'bet' })
    expect(wallet(seen).bet).toBe(50)
    expect(await ui.find({ type: 'Text', text: /< bet 50 >/ })).toBeDefined()
  })

})

describe('the other sites', () => {
  test('the spinner keeps the engine line and appends the pending tool pay', async ($, on) => {
    world(on, { now: 5000 })
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine spinner</Text>
    })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...SPINNER })
      expect(await ui.find({ type: 'Text', text: 'engine spinner' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /2 tool calls → \+20/ })).toBeDefined()
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('the turn line carries the tally of the turn it closes and leaves other turns alone', async ($, on) => {
    world(on)
    on('ui.render', { component: 'TurnDuration' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete({ answer: 'ok', durationMs: 7777, isAborted: false, turnId: 't1', reason: 'answer' })
    const mine = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 7777 } })
    expect(await mine.find({ type: 'Text', text: 'engine' })).toBeUndefined()
    expect(await mine.find({ type: 'Text', text: /^✻ Baked for 8s · done \d+:\d\d [AP]M · \u{F1114} \+10 /u })).toBeDefined()
    const other = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'TurnDuration', props: { word: 'Baked', durationMs: 1 } })
    expect(await other.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await other.find({ type: 'Text', text: /\u{F1114}/u })).toBeUndefined()
  })
})

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

describe('/slop', () => {
  test('registers on session start and answers bet, stats and reset', async ($, on) => {
    const { seen } = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect((await $.command.run({ command: 'slop', args: 'bet 40', ...RUN })).text).toContain('40')
    expect(wallet(seen).bet).toBe(40)
    expect((await $.command.run({ command: 'slop', args: 'stats', ...RUN })).text).toContain('Lifetime')
    await submit($, 'abc')
    expect(wallet(seen).balance).toBe(103)
    expect((await $.command.run({ command: 'slop', args: 'reset', ...RUN })).text).toContain('reset')
    expect(wallet(seen).balance).toBe(100)
  })

  test('8 mutes the clips and the voice, and the mute survives a session start', { options: { band: 'expanded' } }, async ($, on) => {
    const { seen, clock } = world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect((await ui.find({ type: 'Button', key: 'mute' }))?.props.hotkey).toBe('8')
    await ui.press({ key: 'mute' })
    expect((await ui.find({ type: 'Button', key: 'mute' }))?.props.label).toBe('8: unmute')
    await ui.press({ key: 'spin' })
    expect(seen.played).toHaveLength(0)
    await clock.advance(33 * 80)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(seen.state.isMuted).toBe(true)
    await clock.advance(140 * 3)
    expect(seen.blits.filter(k => k === 'title').length).toBeGreaterThanOrEqual(3)
    await ui.press({ key: 'mute' })
    await ui.press({ key: 'spin' })
    expect(seen.played).toContain('sounds/spin.wav')
  })

  test('a configured starting balance applies to a fresh wallet', { options: { startingBalance: 1000 } }, async ($, on) => {
    const { seen } = world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(wallet(seen).balance).toBe(1000)
  })

  test('the band starts hidden unless the setting says expanded', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'show' })).toBeDefined()
  })

  test('an expanded band setting starts with the reels on screen', { options: { band: 'expanded' } }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Raster', key: 'band' })).toBeDefined()
  })
})

describe('hall of fame', () => {
  test('every settled spin lands in the store and the band shows the lifetime count', async ($, on) => {
    const { clock } = world(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    for (let i = 0; i < 3; i++) {
      await ui.press({ key: 'spin' })
      await clock.advance(33 * 80)
    }
    expect(await ui.find({ type: 'Text', text: /over 3 spins/ })).toBeDefined()
  })
})
