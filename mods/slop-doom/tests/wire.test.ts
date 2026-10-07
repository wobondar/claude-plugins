import { describe, expect, test } from 'claude-code/testing'

import { CONTROLS, HOLD_MS, KEY, WEAPONS, blankCells, emptyLog, press, releaseAll, releaseDue, serialize, shapeFor, splitLines } from '../hooks/wire'
import type { Control } from '../hooks/wire'

const control = (key: string): Control => {
  const found = [...CONTROLS, ...WEAPONS].find(c => c.key === key)
  if (found === undefined) throw new Error(`no control ${key}`)
  return found
}

describe('key hold', () => {
  test('a press is a key down, released after the hold', () => {
    let log = press(emptyLog(), control('forward'), 1000)
    expect(log.events).toEqual([{ seq: 1, isDown: true, code: KEY.up }])
    log = releaseDue(log, 1000 + HOLD_MS - 1)
    expect(log.events).toHaveLength(1)
    log = releaseDue(log, 1000 + HOLD_MS)
    expect(log.events[1]).toEqual({ seq: 2, isDown: false, code: KEY.up })
    expect(log.held).toEqual([])
  })

  test('a repeat extends the hold without a second key down', () => {
    let log = press(emptyLog(), control('forward'), 1000)
    log = press(log, control('forward'), 1100)
    expect(log.events).toHaveLength(1)
    log = releaseDue(log, 1000 + HOLD_MS)
    expect(log.events).toHaveLength(1)
    log = releaseDue(log, 1100 + HOLD_MS)
    expect(log.events).toHaveLength(2)
  })

  test('run toggles and stays down until toggled again', () => {
    let log = press(emptyLog(), control('run'), 1000)
    expect(log.events).toEqual([{ seq: 1, isDown: true, code: KEY.shift }])
    log = releaseDue(log, 99_000)
    expect(log.held).toHaveLength(1)
    log = press(log, control('run'), 100_000)
    expect(log.events[1]).toEqual({ seq: 2, isDown: false, code: KEY.shift })
    expect(log.held).toEqual([])
  })

  test('releaseAll lifts every key', () => {
    let log = press(emptyLog(), control('forward'), 1000)
    log = press(log, control('fire'), 1000)
    log = press(log, control('run'), 1000)
    log = releaseAll(log)
    expect(log.held).toEqual([])
    expect(log.events.filter(e => !e.isDown).map(e => e.code).sort()).toEqual([KEY.up, KEY.fire, KEY.shift].sort())
  })

  test('serialize writes one event per line with its sequence', () => {
    let log = press(emptyLog(), control('weapon3'), 1000)
    log = releaseAll(log)
    expect(serialize(log)).toBe(`1 d ${0x33}\n2 u ${0x33}\n`)
  })

  test('only the newest 64 events are kept', () => {
    let log = emptyLog()
    for (let i = 0; i < 50; i++) {
      log = press(log, control('fire'), i * 1000)
      log = releaseDue(log, i * 1000 + HOLD_MS)
    }
    expect(log.events).toHaveLength(64)
    expect(log.seq).toBe(100)
    expect(log.events[0]?.seq).toBe(37)
  })
})

describe('frames', () => {
  test('splitLines keeps a partial tail for the next piece', () => {
    const a = splitLines('', 'L ready\nF AAA')
    expect(a.lines).toEqual(['L ready'])
    expect(a.rest).toBe('F AAA')
    const b = splitLines(a.rest, 'A=\nF BBBB\n')
    expect(b.lines).toEqual(['F AAAA=', 'F BBBB'])
    expect(b.rest).toBe('')
  })

  test('shapeFor keeps the aspect and the Raster bounds', () => {
    expect(shapeFor(80)).toEqual({ columns: 80, rows: 24 })
    expect(shapeFor(120)).toEqual({ columns: 120, rows: 36 })
    expect(shapeFor(10)).toEqual({ columns: 40, rows: 12 })
    expect(shapeFor(9999).columns).toBe(512)
  })

  test('blankCells packs columns times rows triplets', () => {
    const cells = blankCells({ columns: 4, rows: 2 })
    expect(cells).toHaveLength(Math.ceil((4 * 2 * 12) / 3) * 4)
    expect(cells.startsWith('gCUAABgQ')).toBe(true)
  })
})
