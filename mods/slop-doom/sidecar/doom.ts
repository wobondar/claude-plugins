// Runs doomgeneric (WASM) outside the plugin sandbox. Frames go to stdout as
// `F <base64 cells>` lines ready for a Raster, or, with `--out`, as native
// 320x200 RGB written to that file (rename for atomicity) and announced as
// `I <generation>`. Key events come from a file the hooks module rewrites,
// since the child's stdin is closed at start.
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { packCells } from './cells'
import type { Blocks } from './cells'

type DoomModule = {
  _doomgeneric_Create: (argc: number, argv: number) => void
  _doomgeneric_Tick: () => void
  _DG_GetFrameBuffer: () => number
  _DG_GetScreenWidth: () => number
  _DG_GetScreenHeight: () => number
  _DG_PushKeyEvent: (pressed: number, key: number) => void
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  HEAPU8: Uint8Array
  FS_createDataFile: (parent: string, name: string, data: number[], canRead: boolean, canWrite: boolean) => void
  FS_createPath: (parent: string, path: string, canRead: boolean, canWrite: boolean) => string
  setValue: (ptr: number, value: number, type: string) => void
}

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] !== undefined ? (process.argv[at + 1] as string) : fallback
}

const COLS = Number(arg('cols', '80'))
const ROWS = Number(arg('rows', '24'))
const FPS = Number(arg('fps', '20'))
const KEYS = arg('keys', '')
const WAD = arg('wad', '')
const FILTER = arg('filter', 'mode')
const BLOCKS: Blocks = arg('blocks', 'quad') === 'half' ? 'half' : 'quad'
const OUT = arg('out', '')

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = join(here, '..', 'doom')
const doomJs = join(buildDir, 'doom.js')
const wadPath = WAD === '' ? join(buildDir, 'doom1.wad') : WAD

const say = (text: string): void => {
  process.stdout.write(`L ${text}\n`)
}

const loadModule = async (): Promise<DoomModule> => {
  const wad = Array.from(new Uint8Array(readFileSync(wadPath)))
  const code = readFileSync(doomJs, 'utf-8')
  const mod: { exports: unknown } = { exports: {} }
  const factory = new Function('module', 'exports', '__dirname', '__filename', 'require', code)
  factory(mod, mod.exports, buildDir, doomJs, createRequire(doomJs))
  const create = mod.exports as (config: unknown) => Promise<DoomModule>
  return create({
    locateFile: (p: string) => (p.endsWith('.wasm') ? join(buildDir, p) : p),
    print: () => undefined,
    printErr: (text: string) => say(`doom: ${text}`),
    preRun: [(m: DoomModule) => {
      m.FS_createPath('/', 'doom', true, true)
      m.FS_createDataFile('/doom', 'doom1.wad', wad, true, false)
    }],
  })
}

const start = (doom: DoomModule): void => {
  const args = ['doom', '-iwad', '/doom/doom1.wad']
  const ptrs = args.map(a => {
    const p = doom._malloc(a.length + 1)
    for (let i = 0; i < a.length; i++) doom.setValue(p + i, a.charCodeAt(i), 'i8')
    doom.setValue(p + a.length, 0, 'i8')
    return p
  })
  const argv = doom._malloc(ptrs.length * 4)
  ptrs.forEach((p, i) => doom.setValue(argv + i * 4, p, 'i32'))
  doom._doomgeneric_Create(args.length, argv)
}

// Each picture pixel covers a small source rectangle. `box` averages it (soft),
// `nearest` takes its first pixel (noisy), `mode` averages only the pixels of
// the rectangle's most common colour, which keeps edges crisp without noise.
const PX_COLS = BLOCKS === 'quad' ? COLS * 2 : COLS
const PX_ROWS = ROWS * 2
const picture = new Uint32Array(PX_COLS * PX_ROWS)
const words = new Uint32Array(COLS * ROWS * 3)
const keys = new Int32Array(64)
const counts = new Int32Array(64)

const coarse = (c: number): number => c & 0xe0e0e0

const reduce = (heap: Uint32Array, W: number, x0: number, x1: number, y0: number, y1: number): number => {
  if (FILTER === 'nearest') return (heap[y0 * W + x0] ?? 0) & 0xffffff
  let want = -1
  if (FILTER === 'mode') {
    let used = 0
    let best = 0
    for (let y = y0; y < y1; y++) {
      const base = y * W
      for (let x = x0; x < x1; x++) {
        const key = coarse(heap[base + x] ?? 0)
        let at = 0
        while (at < used && keys[at] !== key) at++
        if (at === used) {
          if (used === keys.length) continue
          keys[used] = key
          counts[used] = 0
          used++
        }
        const n = (counts[at] ?? 0) + 1
        counts[at] = n
        if (n > best) {
          best = n
          want = key
        }
      }
    }
  }
  let r = 0, g = 0, b = 0, n = 0
  for (let y = y0; y < y1; y++) {
    const base = y * W
    for (let x = x0; x < x1; x++) {
      const c = (heap[base + x] ?? 0) & 0xffffff
      if (want !== -1 && coarse(c) !== want) continue
      r += (c >> 16) & 0xff
      g += (c >> 8) & 0xff
      b += c & 0xff
      n++
    }
  }
  return n === 0 ? 0 : (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
}

const downsample = (heap: Uint32Array, W: number, H: number): void => {
  for (let py = 0; py < PX_ROWS; py++) {
    const y0 = Math.floor(py * H / PX_ROWS)
    const y1 = Math.max(y0 + 1, Math.floor((py + 1) * H / PX_ROWS))
    for (let px = 0; px < PX_COLS; px++) {
      const x0 = Math.floor(px * W / PX_COLS)
      const x1 = Math.max(x0 + 1, Math.floor((px + 1) * W / PX_COLS))
      picture[py * PX_COLS + px] = reduce(heap, W, x0, x1, y0, y1)
    }
  }
}

let packMs = 0
let packed = 0
let remappedCells = 0

const encodeFrame = (doom: DoomModule, fb: number, W: number, H: number): string => {
  const t0 = performance.now()
  const heap = new Uint32Array(doom.HEAPU8.buffer, fb, W * H)
  downsample(heap, W, H)
  const result = packCells(picture, COLS, ROWS, BLOCKS, words)
  packMs += performance.now() - t0
  packed++
  remappedCells += result.remapped
  if (packed % 200 === 0) {
    say(`pack ${(packMs / 200).toFixed(2)} ms/frame, ${(remappedCells / 200).toFixed(0)} cells redirected/frame`)
    packMs = 0
    remappedCells = 0
  }
  return Buffer.from(words.buffer).toString('base64')
}

// The build renders DOOM's 320x200 and doubles every pixel into 640x400, so
// sampling every other pixel is the native picture at a quarter of the bytes.
// A VGA pixel was 1.2 times taller than wide: 320x200 filled a 4:3 screen, so
// the picture goes out as 320x240 and a 4:3 box shows it with no bands.
const NATIVE_W = 320
const OUT_H = 240
const rgb = Buffer.alloc(NATIVE_W * OUT_H * 3)

const writeNative = (doom: DoomModule, fb: number, W: number, H: number): void => {
  const heap = new Uint32Array(doom.HEAPU8.buffer, fb, W * H)
  const sx = W / NATIVE_W
  const sy = H / OUT_H
  let at = 0
  for (let y = 0; y < OUT_H; y++) {
    const base = Math.floor(y * sy) * W
    for (let x = 0; x < NATIVE_W; x++) {
      const c = heap[base + Math.floor(x * sx)] ?? 0
      rgb[at++] = (c >> 16) & 0xff
      rgb[at++] = (c >> 8) & 0xff
      rgb[at++] = c & 0xff
    }
  }
  writeFileSync(`${OUT}.tmp`, rgb)
  renameSync(`${OUT}.tmp`, OUT)
}

const removeOut = (): void => {
  if (OUT === '') return
  for (const path of [OUT, `${OUT}.tmp`]) {
    try {
      unlinkSync(path)
    } catch {
      continue
    }
  }
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    removeOut()
    process.exit(0)
  })
}

let lastSeq = 0
let lastMtime = 0

const pollKeys = (doom: DoomModule): void => {
  if (KEYS === '') return
  let mtime = 0
  try {
    mtime = statSync(KEYS).mtimeMs
  } catch {
    return
  }
  if (mtime === lastMtime) return
  lastMtime = mtime
  let text = ''
  try {
    text = readFileSync(KEYS, 'utf-8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const [seq, state, code] = line.trim().split(' ')
    const n = Number(seq)
    if (!Number.isFinite(n) || n <= lastSeq || (state !== 'd' && state !== 'u')) continue
    lastSeq = n
    doom._DG_PushKeyEvent(state === 'd' ? 1 : 0, Number(code))
  }
}

const main = async (): Promise<void> => {
  const doom = await loadModule()
  start(doom)
  const W = doom._DG_GetScreenWidth()
  const H = doom._DG_GetScreenHeight()
  const fb = doom._DG_GetFrameBuffer()
  say(OUT === '' ? `ready ${W}x${H} -> ${PX_COLS}x${PX_ROWS} ${BLOCKS}` : `ready ${W}x${H} -> ${NATIVE_W}x${OUT_H} rgb at ${OUT}`)
  const tickMs = 1000 / 35
  const frameEvery = Math.max(1, Math.round(35 / FPS))
  let ticks = 0
  let framedAt = 0
  let generation = 0
  let next = performance.now()
  const loop = (): void => {
    const now = performance.now()
    let ran = 0
    while (next <= now && ran < 3) {
      pollKeys(doom)
      try {
        doom._doomgeneric_Tick()
      } catch (error) {
        say(`exit ${error instanceof Error ? error.message : String(error)}`)
        removeOut()
        process.exit(0)
      }
      ticks++
      next += tickMs
      ran++
    }
    if (ran === 0) next = Math.max(next, now)
    if (ticks - framedAt >= frameEvery) {
      framedAt = ticks
      if (OUT === '') {
        process.stdout.write(`F ${encodeFrame(doom, fb, W, H)}\n`)
      } else {
        writeNative(doom, fb, W, H)
        generation++
        process.stdout.write(`I ${generation}\n`)
      }
    }
    setTimeout(loop, Math.max(1, next - performance.now()))
  }
  loop()
}

void main()
