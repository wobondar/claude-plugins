#!/usr/bin/env bun
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RATE = 22050

type Note = { hz: number; ms: number; gain?: number; wave?: 'sine' | 'square' | 'saw' | 'noise' }

const synth = (notes: Note[]): Float32Array => {
  const total = notes.reduce((n, note) => n + Math.round((note.ms / 1000) * RATE), 0)
  const out = new Float32Array(total)
  let at = 0
  for (const { hz, ms, gain = 0.5, wave = 'sine' } of notes) {
    const len = Math.round((ms / 1000) * RATE)
    for (let i = 0; i < len; i++) {
      const t = i / RATE
      const env = Math.min(1, i / 200) * Math.min(1, (len - i) / 600)
      const phase = (t * hz) % 1
      const sample =
        wave === 'sine' ? Math.sin(2 * Math.PI * t * hz)
        : wave === 'square' ? (phase < 0.5 ? 1 : -1) * 0.6
        : wave === 'saw' ? (phase * 2 - 1) * 0.7
        : Math.random() * 2 - 1
      out[at + i] = sample * gain * env
    }
    at += len
  }
  return out
}

const wav = (samples: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true))
  return bytes
}

const spin: Note[] = []
for (let i = 0; i < 14; i++) spin.push({ hz: 180 + (i % 3) * 40, ms: 45, gain: 0.25, wave: 'square' }, { hz: 1, ms: 25, gain: 0 })

const win: Note[] = [
  { hz: 523, ms: 90 }, { hz: 659, ms: 90 }, { hz: 784, ms: 90 }, { hz: 1047, ms: 220 },
]

const jackpot: Note[] = [
  { hz: 523, ms: 80 }, { hz: 659, ms: 80 }, { hz: 784, ms: 80 }, { hz: 1047, ms: 80 },
  { hz: 784, ms: 80 }, { hz: 1047, ms: 80 }, { hz: 1319, ms: 80 }, { hz: 1568, ms: 300 },
  { hz: 1, ms: 60, gain: 0 },
  { hz: 1568, ms: 70 }, { hz: 1, ms: 40, gain: 0 }, { hz: 1568, ms: 70 }, { hz: 1, ms: 40, gain: 0 }, { hz: 2093, ms: 500 },
]

const lose: Note[] = [
  { hz: 330, ms: 160, wave: 'saw', gain: 0.35 }, { hz: 262, ms: 160, wave: 'saw', gain: 0.35 }, { hz: 196, ms: 160, wave: 'saw', gain: 0.35 }, { hz: 131, ms: 420, wave: 'saw', gain: 0.35 },
]

const out = join(import.meta.dir, '..', 'sounds')
for (const [name, notes] of Object.entries({ spin, win, jackpot, lose })) {
  writeFileSync(join(out, `${name}.wav`), wav(synth(notes)))
  console.log(`wrote sounds/${name}.wav`)
}
