import { describe, expect, test } from 'claude-code/testing'

import { FRAME_COLUMNS, FRAME_ROWS, TITLE_COLUMNS, packCells, readoutFor, renderFrame, renderTitle } from '../hooks/raster'
import {
  BOUNCE_TICKS, STRIP, STRIP_LENGTH, formatCld, frameAt, idleMachine, isLanding, judge, nextBet, planSpin, signedCld, spinLength, symbolAt, toastFrame, visibleSymbols,
} from '../hooks/reels'

const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length] as number
}

describe('judge', () => {
  test('three sevens is the jackpot at 77x', async () => {
    const o = judge(['seven', 'seven', 'seven'], 25)
    expect(o.tier).toBe('jackpot')
    expect(o.payout).toBe(25 * 77)
  })

  test('three any is a fine, not a win', async () => {
    const o = judge(['any', 'any', 'any'], 25)
    expect(o.tier).toBe('cursed')
    expect(o.payout).toBe(-100)
  })

  test('two cherries pay 2x, one cherry gives most of the bet back', async () => {
    expect(judge(['cherry', 'bar', 'cherry'], 50).payout).toBe(100)
    expect(judge(['bar', 'cherry', 'coin'], 50).payout).toBe(30)
  })

  test('a non-cherry pair pays 1.2x, floored', async () => {
    const o = judge(['bar', 'diamond', 'bar'], 25)
    expect(o.payout).toBe(30)
    expect(o.title).toBe('two bars')
  })

  test('nothing matching pays nothing and picks a loss line from the rng', async () => {
    const o = judge(['seven', 'bar', 'diamond'], 25, seq(0))
    expect(o.payout).toBe(0)
    expect(o.tier).toBe('lose')
    expect(o.title).toBe('slop.')
  })
})

describe('reels', () => {
  test('the strip wraps in both directions', async () => {
    expect(symbolAt(STRIP_LENGTH)).toBe(STRIP[0])
    expect(symbolAt(-1)).toBe(STRIP[STRIP_LENGTH - 1])
  })

  test('a free-spinning reel scrolls one row per tick and wraps the strip', async () => {
    const plan = planSpin(seq(0.5, 0.1, 0.9))
    const start = [STRIP_LENGTH - 1, 0, 0] as const
    expect(frameAt(start, plan, 1).reels[0]).toEqual({ index: STRIP_LENGTH - 1, offset: 1 })
    expect(frameAt(start, plan, 3).reels[0]).toEqual({ index: 0, offset: 0 })
  })

  test('every reel lands on its planned target, bounces once and rests at offset zero', async () => {
    const plan = planSpin(seq(0.5, 0.1, 0.9))
    const start = [0, 1, 2] as const
    const landed: number[] = []
    let last = frameAt(start, plan, 0)
    for (let tick = 1; tick <= spinLength(plan); tick++) {
      last = frameAt(start, plan, tick)
      last.stopped.forEach((s, r) => {
        if (s && landed[r] === undefined) landed[r] = tick
      })
      plan.stopAt.forEach((landing, r) => {
        if (tick === landing) expect(last.reels[r]).toEqual({ index: plan.targets[r], offset: 0 })
        if (tick === landing + 1) expect(last.reels[r]).toEqual({ index: plan.targets[r], offset: 1 })
        if (tick === landing + BOUNCE_TICKS) expect(last.reels[r]).toEqual({ index: plan.targets[r], offset: 0 })
      })
      expect(isLanding(plan, tick)).toBe(plan.stopAt.includes(tick))
    }
    expect(landed).toEqual([...plan.stopAt])
    expect(last.reels.map(r => r.index)).toEqual([...plan.targets])
    expect(last.reels.every(r => r.offset === 0)).toBe(true)
    expect(visibleSymbols({ ...idleMachine(), reels: last.reels })).toEqual(plan.targets.map(symbolAt))
  })

  test('the frame is a full raster of width-one BMP cells', async () => {
    const m = idleMachine()
    const cells = renderFrame(m, { lit: 0, readout: 'BET 25 · 1 to spin' })
    expect(cells).toHaveLength(FRAME_COLUMNS * FRAME_ROWS)
    for (const [cp] of cells) {
      expect(cp).toBeGreaterThanOrEqual(0x20)
      expect(cp).toBeLessThan(0x10000)
      expect(cp === 0x7f || (cp >= 0xd800 && cp <= 0xdfff)).toBe(false)
    }
    const packed = packCells(cells)
    expect(packed.length).toBe(Math.ceil((cells.length * 12) / 3) * 4)
    expect(/^[A-Za-z0-9+/]+=*$/.test(packed)).toBe(true)
  })

  test('every symbol tile renders at every scroll offset', async () => {
    for (let index = 0; index < STRIP_LENGTH; index++) {
      for (let offset = 0; offset < 3; offset++) {
        const m = { ...idleMachine(), reels: [{ index, offset }, { index, offset }, { index, offset }] as const }
        expect(renderFrame({ ...m, reels: [...m.reels] as [typeof m.reels[0], typeof m.reels[1], typeof m.reels[2]] }, { lit: index, readout: '' })).toHaveLength(FRAME_COLUMNS * FRAME_ROWS)
      }
    }
  })

  test('the title is one gradient cell per letter and the colours move with the phase', async () => {
    const a = renderTitle(0)
    const b = renderTitle(0.5)
    expect(a).toHaveLength(TITLE_COLUMNS)
    expect(String.fromCodePoint(...a.map(c => c[0]))).toBe(' SLOP MACHINE ')
    expect(a.map(c => c[1])).not.toEqual(b.map(c => c[1]))
    expect(packCells(a).length).toBe(Math.ceil((TITLE_COLUMNS * 12) / 3) * 4)
    const chased = renderTitle(0, { chaser: 3, isFlashing: false })
    expect(chased[3]?.[1]).toBe(0xffffff)
    expect(chased[4]?.[1]).toBe(0xffffff)
    expect(chased[5]?.[1]).not.toBe(0xffffff)
    const flash = renderTitle(0, { chaser: 0, isFlashing: true })
    expect(new Set(flash.map(c => c[1])).size).toBe(1)
  })

  test('the readout follows the phase', async () => {
    const idle = idleMachine()
    expect(readoutFor(idle, 25, '1 to spin').readout).toBe('BET 25 · 1 to spin')
    expect(readoutFor({ ...idle, phase: 'spinning' }, 25, '').readout).toContain('spinning')
    const won = { ...idle, phase: 'result' as const, outcome: judge(['seven', 'seven', 'seven'], 25) }
    expect(readoutFor(won, 25, '').readout).toBe('JACKPOT 777 +1,925')
  })

  test('toast frames mark stopped reels with brackets', async () => {
    const m = { ...idleMachine(), stopped: [true, false, true] as [boolean, boolean, boolean] }
    const frame = toastFrame(m)
    expect(frame.startsWith('\u{F1114} [')).toBe(true)
    expect(frame).toContain('~')
  })
})

describe('money', () => {
  test('formats with thousands separators and signs', async () => {
    expect(formatCld(1925)).toBe('1,925')
    expect(formatCld(-1234567)).toBe('-1,234,567')
    expect(signedCld(0)).toBe('+0')
    expect(signedCld(-5)).toBe('-5')
  })

  test('the bet cycles through the presets and wraps', async () => {
    expect(nextBet(25)).toBe(50)
    expect(nextBet(500)).toBe(25)
    expect(nextBet(33)).toBe(25)
  })
})
