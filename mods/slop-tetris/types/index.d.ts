export type TetrisPhase = 'idle' | 'playing' | 'paused' | 'over'

export type TetrisLive = {
  isOpen: boolean
  phase: TetrisPhase
  score: number
  lines: number
  level: number
  pieces: number
}

export type TetrisGame = {
  score: number
  lines: number
  level: number
  pieces: number
  endedAt: number
}

export type TetrisCommand = {
  seq: number
  action: 'left' | 'right' | 'cw' | 'ccw' | 'flip' | 'soft' | 'hard' | 'hold' | 'pause' | 'new'
}

declare module 'claude-code' {
  interface PluginState {
    'slop-tetris': {
      live: TetrisLive
      lastGame: TetrisGame | null
      highScore: number
      command: TetrisCommand
    }
  }
}
