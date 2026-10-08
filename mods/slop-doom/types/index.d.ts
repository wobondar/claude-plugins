export type DoomDisplay = 'image' | 'cells'

export type DoomPicture = {
  file: string
  width: number
  height: number
  generation: number
}

export type DoomScreen = {
  isRunning: boolean
  display: DoomDisplay
  picture: DoomPicture | null
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
