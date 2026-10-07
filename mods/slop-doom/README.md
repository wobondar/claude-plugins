# slop-doom

DOOM (the shareware episode) in a Claude Code pane.

![slop-doom: the DOOM title screen in a pane](../../assets/slop-doom.png)

`/doom` opens the game as wide as the terminal allows, up to 160 columns; `/doom 100` picks a width; `/doom 140 20` also sets the frames a second for that run; `/doom close` ends it. Esc hands the keys back to the prompt while the game keeps running; `ctrl+x tab` or a click returns them.

## Keys

| key | does |
| --- | --- |
| `w` `s` | forward, back |
| `a` `d` | turn |
| `q` `e` | strafe |
| `f` | fire |
| `u` | use: doors, switches |
| `r` | run, toggled |
| `n` | enter |
| `x` | menu (DOOM's Escape) |
| `y` | yes |
| `m` | map |
| `p` | pause |
| `1` to `7` | fist, pistol, shotgun, chaingun, rocket, plasma, bfg |

A press holds the key for 160 ms, and the terminal's key repeat extends the hold, so holding `w` walks. Run stays on until pressed again.

## Requirements

`bun` on the PATH, or `node` 23.6 or newer. The sidecar is TypeScript and either runs it as is.

## How it works

The plugin sandbox has no WebAssembly and no Node, so DOOM runs in a sidecar process that `$.process.spawn` starts: `sidecar/doom.ts` loads the doomgeneric WASM build, ticks it at 35 Hz, and writes frames to stdout. Each frame is already the base64 cell string of a terminal `Raster`: one `▀` per cell, the top pixel as foreground, the bottom as background, so a pane 140 columns wide shows 140 by 84 pixels. The hooks module blits every line it receives straight into the Raster, no render pass.

Each half-cell covers a small rectangle of the 640 by 400 frame. The sidecar's `--filter` picks how that rectangle becomes one colour: `mode` (the default) averages only the pixels of the rectangle's most common colour, which keeps edges crisp; `box` averages everything, which is softer; `nearest` takes one pixel. A frame that would need more than the Raster's 1024 distinct colour pairs is quantized until it fits.

The child's stdin is closed at start, so keys travel through a small file in `/tmp` that the hooks module rewrites on every press and release and the sidecar polls between ticks.

Settings: `/config` lists `Frames per second` (default 15; the sidecar ticks at 35 regardless).

## Install

```
/plugin install slop-doom --marketplace wobondar/claude-plugins
```

Answer `y` to add the marketplace, then pick a scope. To run from a checkout instead: `claude --plugin-dir ./mods/slop-doom`.

## Develop

```
claude plugin validate ./mods/slop-doom
claude plugin test ./mods/slop-doom
bun ./mods/slop-doom/sidecar/doom.ts --cols 80 --rows 24 --fps 20 --keys /tmp/keys.txt
```

The pure parts, the key-hold model, the line splitter and the Raster shapes, live in `hooks/wire.ts`. The WASM build is pi-doom's, unchanged; rebuilding it needs Emscripten and `doomgeneric_pi.c` from that repo.

## Credits

- [id Software](https://github.com/id-Software/DOOM) for DOOM and the shareware episode
- [doomgeneric](https://github.com/ozkl/doomgeneric) by Ozkan Sezer, the portable DOOM this runs
- [pi-doom](https://github.com/badlogic/pi-doom) by Mario Zechner, whose Emscripten build and half-block idea this uses as is
- [opentui-doom](https://github.com/muhammedaksam/opentui-doom) by Muhammed Aksam, which showed DOOM in a TUI first

## License

GPL-2.0, see [LICENSE](LICENSE). The rest of this repository is MIT; this mod is the exception because it embeds DOOM.
