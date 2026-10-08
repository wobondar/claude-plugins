import { describe, expect, test } from 'claude-code/testing'

import { MAX_PAIRS, canonical, capPairs, halfCell, packCells, pairKey, quadrantCell } from '../sidecar/cells'

const RED = 0xff0000
const BLUE = 0x0000ff
const BLACK = 0x000000
const WHITE = 0xffffff

describe('quadrant cells', () => {
  test('four equal pixels are a space over that colour', () => {
    expect(quadrantCell([RED, RED, RED, RED])).toEqual({ glyph: 0x20, fg: RED, bg: RED })
  })

  test('a top and bottom split is the upper half block', () => {
    expect(quadrantCell([RED, RED, BLUE, BLUE])).toEqual({ glyph: 0x2580, fg: RED, bg: BLUE })
  })

  test('a left and right split is the left half block', () => {
    expect(quadrantCell([RED, BLUE, RED, BLUE])).toEqual({ glyph: 0x258c, fg: RED, bg: BLUE })
  })

  test('one odd pixel lights its own quadrant, once the pair is canonical', () => {
    expect(canonical(quadrantCell([BLUE, RED, RED, RED]))).toEqual({ glyph: 0x2598, fg: BLUE, bg: RED })
    expect(canonical(quadrantCell([RED, RED, RED, BLUE]))).toEqual({ glyph: 0x2597, fg: BLUE, bg: RED })
  })

  test('a diagonal lights two opposite quadrants', () => {
    expect(canonical(quadrantCell([RED, BLUE, BLUE, RED]))).toEqual({ glyph: 0x259e, fg: BLUE, bg: RED })
  })

  test('close shades go together against a far one and average', () => {
    expect(canonical(quadrantCell([0x100000, 0x120000, 0x110000, WHITE]))).toEqual({ glyph: 0x259b, fg: 0x110000, bg: WHITE })
  })

  test('a half cell is the upper half block, or a space when both match', () => {
    expect(halfCell(RED, BLUE)).toEqual({ glyph: 0x2580, fg: RED, bg: BLUE })
    expect(halfCell(RED, RED)).toEqual({ glyph: 0x20, fg: RED, bg: RED })
  })
})

describe('canonical pairs', () => {
  test('keeps the smaller colour in front and flips the glyph to match', () => {
    expect(canonical({ glyph: 0x2580, fg: RED, bg: BLUE })).toEqual({ glyph: 0x2584, fg: BLUE, bg: RED })
    expect(canonical({ glyph: 0x2598, fg: BLUE, bg: RED })).toEqual({ glyph: 0x2598, fg: BLUE, bg: RED })
    expect(canonical({ glyph: 0x259b, fg: WHITE, bg: BLACK })).toEqual({ glyph: 0x2597, fg: BLACK, bg: WHITE })
  })

  test('a solid cell stays as it is', () => {
    expect(canonical({ glyph: 0x20, fg: RED, bg: RED })).toEqual({ glyph: 0x20, fg: RED, bg: RED })
  })
})

const wordsOf = (pairs: readonly (readonly [number, number])[]): Uint32Array => {
  const words = new Uint32Array(pairs.length * 3)
  pairs.forEach(([fg, bg], i) => {
    words[i * 3] = 0x2580
    words[i * 3 + 1] = fg
    words[i * 3 + 2] = bg
  })
  return words
}

const distinctPairs = (words: Uint32Array, cells: number): number => new Set(Array.from({ length: cells }, (_, i) => pairKey(words[i * 3 + 1] as number, words[i * 3 + 2] as number))).size

describe('pair budget', () => {
  test('a frame within the budget is left alone', () => {
    const words = wordsOf([[RED, BLUE], [RED, BLUE], [BLACK, WHITE]])
    const packed = capPairs(words, 3)
    expect(packed).toEqual({ words, pairs: 2, remapped: 0 })
  })

  test('rare pairs past the budget move to the nearest frequent pair', () => {
    const pairs: [number, number][] = []
    for (let i = 0; i < MAX_PAIRS; i++) {
      const colour = (i * 16) & 0xffffff
      pairs.push([colour, WHITE], [colour, WHITE])
    }
    pairs.push([0x000003, WHITE])
    pairs.push([0xfefefe, 0x010101])
    const words = wordsOf(pairs)
    const packed = capPairs(words, pairs.length)
    expect(packed.pairs).toBe(MAX_PAIRS)
    expect(packed.remapped).toBe(2)
    expect(distinctPairs(packed.words, pairs.length)).toBe(MAX_PAIRS)
    const odd = pairs.length - 2
    expect(words[odd * 3 + 1]).toBe(0x000000)
    expect(words[odd * 3 + 2]).toBe(WHITE)
  })
})

describe('packCells', () => {
  test('packs a 2x2 pixel picture per cell into canonical triplets', () => {
    const px = new Uint32Array([
      RED, RED, BLUE, BLUE,
      RED, RED, BLUE, BLUE,
    ])
    const words = new Uint32Array(2 * 1 * 3)
    const packed = packCells(px, 2, 1, 'quad', words)
    expect(packed.remapped).toBe(0)
    expect(Array.from(words)).toEqual([0x20, RED, RED, 0x20, BLUE, BLUE])
  })

  test('half blocks read one pixel column per cell', () => {
    const px = new Uint32Array([RED, BLUE, BLUE, RED])
    const words = new Uint32Array(2 * 1 * 3)
    packCells(px, 2, 1, 'half', words)
    expect(Array.from(words)).toEqual([0x2584, BLUE, RED, 0x2580, BLUE, RED])
  })
})
