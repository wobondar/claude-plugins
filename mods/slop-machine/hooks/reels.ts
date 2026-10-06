export type SlotSymbol = 'seven' | 'coin' | 'diamond' | 'bar' | 'bun' | 'cherry' | 'any'

export type Site = 'band'

export const SITES: readonly Site[] = ['band']

export type ReelState = { index: number; offset: number }

export type Outcome = {
  symbols: [SlotSymbol, SlotSymbol, SlotSymbol]
  multiplier: number
  payout: number
  title: string
  tier: 'jackpot' | 'big' | 'win' | 'push' | 'lose' | 'cursed'
}

export type MachineState = {
  phase: 'idle' | 'spinning' | 'result'
  reels: [ReelState, ReelState, ReelState]
  stopped: [boolean, boolean, boolean]
  outcome: Outcome | null
  spins: number
}

export const STRIP: readonly SlotSymbol[] = [
  'cherry', 'bar', 'diamond', 'cherry', 'coin', 'bar', 'seven', 'cherry', 'bun',
  'bar', 'diamond', 'cherry', 'any', 'coin', 'bar', 'cherry', 'diamond', 'bun',
  'seven', 'cherry', 'bar', 'coin', 'diamond', 'bun',
]

export const STRIP_LENGTH = STRIP.length

export const BETS: readonly number[] = [25, 50, 100, 250, 500]

export const TOOL_PAY = 10
export const COMBO_EVERY = 10
export const COMBO_BONUS = 100
export const YEET_BONUS = 100

export const CLD = '\u{F16A6}'

export const SLOT = '\u{F1114}'

export const idleMachine = (): MachineState => ({
  phase: 'idle',
  reels: [{ index: 0, offset: 0 }, { index: 1, offset: 0 }, { index: 2, offset: 0 }],
  stopped: [true, true, true],
  outcome: null,
  spins: 0,
})

export const symbolAt = (index: number): SlotSymbol =>
  STRIP[((index % STRIP_LENGTH) + STRIP_LENGTH) % STRIP_LENGTH] as SlotSymbol

export const rollIndex = (rng: () => number): number => Math.floor(rng() * STRIP_LENGTH) % STRIP_LENGTH

const LOSS_TITLES = [
  'slop.',
  'skill issue',
  'the house (Claude) wins',
  'git blame yourself',
  'needs more tokens',
  'try `any`... no wait',
  'compaction ate it',
  'rate limited',
  'unslop skill applied',
]

const TRIPLES: Record<SlotSymbol, { multiplier: number; title: string; tier: Outcome['tier'] }> = {
  seven: { multiplier: 77, title: 'JACKPOT 777', tier: 'jackpot' },
  coin: { multiplier: 25, title: 'PAYDAY', tier: 'big' },
  bun: { multiplier: 20, title: 'bun install', tier: 'big' },
  diamond: { multiplier: 15, title: 'SHINY', tier: 'big' },
  bar: { multiplier: 10, title: 'BAR BAR BAR', tier: 'win' },
  cherry: { multiplier: 6, title: 'CHERRY BOMB', tier: 'win' },
  any: { multiplier: -4, title: 'TYPE ERROR', tier: 'cursed' },
}

const PAIR_TITLES: Record<SlotSymbol, string> = {
  seven: 'two sevens',
  coin: 'two coins',
  bun: 'two buns',
  diamond: 'two diamonds',
  bar: 'two bars',
  cherry: 'two cherries',
  any: 'pair of any',
}

export const judge = (
  symbols: [SlotSymbol, SlotSymbol, SlotSymbol],
  bet: number,
  rng: () => number = Math.random,
): Outcome => {
  const [a, b, c] = symbols
  const finish = (multiplier: number, title: string, tier: Outcome['tier']): Outcome => ({
    symbols,
    multiplier,
    payout: Math.floor(bet * multiplier),
    title,
    tier,
  })

  if (a === b && b === c) {
    const triple = TRIPLES[a]
    return finish(triple.multiplier, triple.title, triple.tier)
  }

  const counts = new Map<SlotSymbol, number>()
  for (const s of symbols) counts.set(s, (counts.get(s) ?? 0) + 1)
  const cherries = counts.get('cherry') ?? 0
  const paired = [...counts.entries()].find(([s, n]) => n === 2 && s !== 'cherry' && s !== 'any')?.[0]

  if (cherries === 2) return finish(2, 'two cherries', 'win')
  if (paired !== undefined) return finish(1.2, PAIR_TITLES[paired], 'win')
  if (cherries === 1) return finish(0.6, 'a cherry', 'push')
  if ((counts.get('any') ?? 0) === 2) return finish(0, 'pair of any, no payout', 'lose')

  return finish(0, LOSS_TITLES[Math.floor(rng() * LOSS_TITLES.length)] ?? 'slop.', 'lose')
}

export const SYMBOL_LABEL: Record<SlotSymbol, string> = {
  seven: ' 7 ',
  coin: ' $ ',
  diamond: ' ◆ ',
  bar: 'BAR',
  bun: 'bun',
  cherry: '🍒 ',
  any: 'any',
}

export const visibleSymbols = (m: MachineState): [SlotSymbol, SlotSymbol, SlotSymbol] => [
  symbolAt(m.reels[0].index),
  symbolAt(m.reels[1].index),
  symbolAt(m.reels[2].index),
]

export type SpinPlan = {
  targets: [number, number, number]
  stopAt: [number, number, number]
}

export const FRAME_MS = 33
export const BOUNCE_TICKS = 3

export const planSpin = (rng: () => number): SpinPlan => ({
  targets: [rollIndex(rng), rollIndex(rng), rollIndex(rng)],
  stopAt: [30, 48, 66],
})

export const spinLength = (plan: SpinPlan): number => plan.stopAt[2] + BOUNCE_TICKS

export type Frame = { reels: [ReelState, ReelState, ReelState]; stopped: [boolean, boolean, boolean] }

const reelAt = (start: number, target: number, landing: number, tick: number): ReelState => {
  if (tick >= landing + BOUNCE_TICKS) return { index: target, offset: 0 }
  if (tick > landing) return { index: target, offset: 1 }
  if (tick === landing) return { index: target, offset: 0 }
  if (tick === landing - 1) return { index: (target - 1 + STRIP_LENGTH) % STRIP_LENGTH, offset: 2 }
  if (tick === landing - 2) return { index: (target - 1 + STRIP_LENGTH) % STRIP_LENGTH, offset: 1 }
  const rows = start * 3 + tick
  return { index: Math.floor(rows / 3) % STRIP_LENGTH, offset: rows % 3 }
}

export const frameAt = (start: readonly [number, number, number], plan: SpinPlan, tick: number): Frame => ({
  reels: [
    reelAt(start[0], plan.targets[0], plan.stopAt[0], tick),
    reelAt(start[1], plan.targets[1], plan.stopAt[1], tick),
    reelAt(start[2], plan.targets[2], plan.stopAt[2], tick),
  ],
  stopped: [tick >= plan.stopAt[0], tick >= plan.stopAt[1], tick >= plan.stopAt[2]],
})

export const isLanding = (plan: SpinPlan, tick: number): boolean => plan.stopAt.includes(tick)

export const formatCld = (n: number): string => {
  const sign = n < 0 ? '-' : ''
  const digits = Math.abs(Math.trunc(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${digits}`
}

export const signedCld = (n: number): string => (n >= 0 ? `+${formatCld(n)}` : formatCld(n))

export const nextBet = (bet: number): number => {
  const at = BETS.indexOf(bet)
  return BETS[(at + 1) % BETS.length] as number
}

export const toastFrame = (m: MachineState): string => {
  const cells = m.reels.map((reel, r) => {
    const label = SYMBOL_LABEL[symbolAt(reel.index)]
    return m.stopped[r] ? `[${label}]` : `~${label}~`
  })
  return `${SLOT} ${cells.join(' ')}`
}
