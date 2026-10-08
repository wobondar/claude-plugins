// Packs a picture into Raster cells. Each cell shows 2x2 pixels as a quadrant
// glyph in two colours, chosen as the split of the four that loses least;
// a frame may hold 1024 distinct colour pairs, so the rarest pairs are
// redirected to their nearest kept pair rather than the whole frame coarsened.

// Glyph for each mask of lit quadrants: bit 1 top-left, 2 top-right,
// 4 bottom-left, 8 bottom-right. Mask 0 is a space over the background.
const QUADRANTS = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588] as const

export const MAX_PAIRS = 1024

export type Blocks = 'quad' | 'half'

export type Cell = { readonly glyph: number; readonly fg: number; readonly bg: number }

const red = (c: number): number => (c >> 16) & 0xff
const green = (c: number): number => (c >> 8) & 0xff
const blue = (c: number): number => c & 0xff
const rgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b

const distance = (a: number, b: number): number => {
  const dr = red(a) - red(b)
  const dg = green(a) - green(b)
  const db = blue(a) - blue(b)
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db
}

// The seven ways to split four pixels in two; the other seven are the same
// splits with the colours swapped. Each mask's lit count is fixed.
const SPLITS = [1, 2, 3, 4, 5, 6, 7] as const
const LIT = [0, 1, 1, 2, 1, 2, 2, 3] as const

const R = new Int32Array(4)
const G = new Int32Array(4)
const B = new Int32Array(4)

const weighted = (dr: number, dg: number, db: number): number => 2 * dr * dr + 4 * dg * dg + 3 * db * db

export const quadrantCell = (px: readonly number[]): Cell => {
  const c0 = px[0] as number
  if (c0 === px[1] && c0 === px[2] && c0 === px[3]) return { glyph: 0x20, fg: c0, bg: c0 }
  let rAll = 0, gAll = 0, bAll = 0
  for (let i = 0; i < 4; i++) {
    const c = px[i] as number
    R[i] = red(c)
    G[i] = green(c)
    B[i] = blue(c)
    rAll += R[i] as number
    gAll += G[i] as number
    bAll += B[i] as number
  }
  let bestMask = 1
  let bestFg = 0
  let bestBg = 0
  let bestError = Number.POSITIVE_INFINITY
  for (const mask of SPLITS) {
    const lit = LIT[mask] as number
    let rLit = 0, gLit = 0, bLit = 0
    for (let i = 0; i < 4; i++) {
      if (((mask >> i) & 1) === 0) continue
      rLit += R[i] as number
      gLit += G[i] as number
      bLit += B[i] as number
    }
    const unlit = 4 - lit
    const fr = rLit / lit, fg = gLit / lit, fb = bLit / lit
    const br = (rAll - rLit) / unlit, bg = (gAll - gLit) / unlit, bb = (bAll - bLit) / unlit
    let error = 0
    for (let i = 0; i < 4; i++) {
      const isLit = ((mask >> i) & 1) === 1
      error += weighted((R[i] as number) - (isLit ? fr : br), (G[i] as number) - (isLit ? fg : bg), (B[i] as number) - (isLit ? fb : bb))
      if (error >= bestError) break
    }
    if (error >= bestError) continue
    bestError = error
    bestMask = mask
    bestFg = rgb(Math.round(fr), Math.round(fg), Math.round(fb))
    bestBg = rgb(Math.round(br), Math.round(bg), Math.round(bb))
  }
  return { glyph: QUADRANTS[bestMask] as number, fg: bestFg, bg: bestBg }
}

export const halfCell = (top: number, bottom: number): Cell => ({ glyph: top === bottom ? 0x20 : 0x2580, fg: top, bg: bottom })

// A cell's two colours as one key, the smaller first; the glyph flips to
// match, so (a over b) and (b over a) count as one pair for the budget.
const inverse = (glyph: number): number => QUADRANTS[15 - QUADRANTS.indexOf(glyph as (typeof QUADRANTS)[number])] as number

export const canonical = (cell: Cell): Cell => (cell.fg <= cell.bg ? cell : { glyph: inverse(cell.glyph), fg: cell.bg, bg: cell.fg })

export const pairKey = (fg: number, bg: number): number => fg * 16777216 + bg

export type Packed = { readonly words: Uint32Array; readonly pairs: number; readonly remapped: number }

const keptFg = new Uint32Array(MAX_PAIRS)
const keptBg = new Uint32Array(MAX_PAIRS)

const nearestKept = (fg: number, bg: number): number => {
  let at = 0
  let best = 0x7fffffff
  for (let i = 0; i < MAX_PAIRS; i++) {
    let d = distance(fg, keptFg[i] as number)
    if (d >= best) continue
    d += distance(bg, keptBg[i] as number)
    if (d < best) {
      best = d
      at = i
    }
  }
  return at
}

// Frames differ little from tick to tick, so a pair's target from the last
// frame is reused while that target is still kept; the scan runs only for
// pairs whose target fell out of the budget.
const REMEMBERED_PAIRS = 50_000
const remembered = new Map<number, number>()

// Words hold [glyph, fg, bg] per cell with fg <= bg. Pairs past the budget
// move to the nearest kept pair, each distinct pair looked up once.
export const capPairs = (words: Uint32Array, cells: number): Packed => {
  const counts = new Map<number, number>()
  for (let i = 0; i < cells; i++) {
    const key = pairKey(words[i * 3 + 1] as number, words[i * 3 + 2] as number)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (counts.size <= MAX_PAIRS) return { words, pairs: counts.size, remapped: 0 }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const keptIndex = new Map<number, number>()
  for (let i = 0; i < MAX_PAIRS; i++) {
    const key = (ranked[i] as [number, number])[0]
    const fg = Math.floor(key / 16777216)
    const bg = key % 16777216
    keptFg[i] = fg
    keptBg[i] = bg
    keptIndex.set(key, i)
  }
  if (remembered.size > REMEMBERED_PAIRS) remembered.clear()
  let remapped = 0
  for (let i = 0; i < cells; i++) {
    const fg = words[i * 3 + 1] as number
    const bg = words[i * 3 + 2] as number
    const key = pairKey(fg, bg)
    if (keptIndex.has(key)) continue
    const known = remembered.get(key)
    let at = known === undefined ? undefined : keptIndex.get(known)
    if (at === undefined) {
      at = nearestKept(fg, bg)
      remembered.set(key, pairKey(keptFg[at] as number, keptBg[at] as number))
    }
    words[i * 3 + 1] = keptFg[at] as number
    words[i * 3 + 2] = keptBg[at] as number
    remapped++
  }
  return { words, pairs: MAX_PAIRS, remapped }
}

// `px` holds the picture row-major at 2*cols by 2*rows (quad) or cols by
// 2*rows (half); `words` receives cols*rows triplets.
export const packCells = (px: Uint32Array, cols: number, rows: number, blocks: Blocks, words: Uint32Array): Packed => {
  const pxCols = blocks === 'quad' ? cols * 2 : cols
  const four: number[] = [0, 0, 0, 0]
  for (let row = 0; row < rows; row++) {
    const top = row * 2 * pxCols
    const bottom = top + pxCols
    for (let col = 0; col < cols; col++) {
      let cell: Cell
      if (blocks === 'quad') {
        four[0] = px[top + col * 2] ?? 0
        four[1] = px[top + col * 2 + 1] ?? 0
        four[2] = px[bottom + col * 2] ?? 0
        four[3] = px[bottom + col * 2 + 1] ?? 0
        cell = canonical(quadrantCell(four))
      } else {
        cell = canonical(halfCell(px[top + col] ?? 0, px[bottom + col] ?? 0))
      }
      const i = (row * cols + col) * 3
      words[i] = cell.glyph
      words[i + 1] = cell.fg
      words[i + 2] = cell.bg
    }
  }
  return capPairs(words, cols * rows)
}
