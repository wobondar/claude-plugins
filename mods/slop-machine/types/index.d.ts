export type SlopSymbol = 'seven' | 'coin' | 'diamond' | 'bar' | 'bun' | 'cherry' | 'any'

export type SlopSite = 'band'

export type SlopReel = { index: number; offset: number }

export type SlopOutcome = {
  symbols: [SlopSymbol, SlopSymbol, SlopSymbol]
  multiplier: number
  payout: number
  title: string
  tier: 'jackpot' | 'big' | 'win' | 'push' | 'lose' | 'cursed'
}

export type SlopMachine = {
  phase: 'idle' | 'spinning' | 'result'
  reels: [SlopReel, SlopReel, SlopReel]
  stopped: [boolean, boolean, boolean]
  outcome: SlopOutcome | null
  spins: number
}

export type SlopWallet = {
  balance: number
  bet: number
  fromPrompts: number
  fromTools: number
  fromSpins: number
  wagered: number
  won: number
  spins: number
  biggestWin: number
}

export type SlopTurn = {
  isWorking: boolean
  tools: number
  combos: number
  spins: number
  spinsNet: number
  startedAt: number
}

export type SlopTally = {
  tools: number
  toolPay: number
  comboPay: number
  spins: number
  spinsNet: number
  net: number
  durationMs: number
  endedAt?: number
  balance: number
}

export type SlopHistoryEntry = {
  site: SlopSite
  outcome: SlopOutcome
  bet: number
  at: number
}

export type SlopHallOfFame = {
  lifetimeNet: number
  lifetimeSpins: number
  biggestWin: number
  jackpots: number
  typeErrors: number
  sessions: number
}

declare module 'claude-code' {
  interface PluginState {
    'slop-machine': {
      wallet: SlopWallet
      turn: SlopTurn
      tallies: Record<string, SlopTally>
      history: SlopHistoryEntry[]
      marquee: number
      isHidden: boolean
      isMuted: boolean
      machine: StateFamily<SlopMachine>
    }
  }
}
