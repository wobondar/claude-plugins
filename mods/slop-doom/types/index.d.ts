export type DoomScreen = {
  isRunning: boolean
  columns: number
  rows: number
  status: string
  frames: number
}

declare module 'claude-code' {
  interface PluginState {
    'slop-doom': {
      screen: DoomScreen
    }
  }
}
