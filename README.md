# claude-plugins

Mods for Claude Code: live panes, bands, status lines and hooks, written as plugins of function hooks that hot-reload while you work.

## Mods

### [slop-machine](mods/slop-machine)

A three-reel slot machine above the prompt, paid in `󱚦` Claude Dollars you earn by prompting and Claude earns by calling tools.

```
/plugin install slop-machine --marketplace wobondar/claude-plugins
```

![slop-machine: a slot machine above the prompt](assets/slop-machine.png)

### [slop-tetris](mods/slop-tetris)

Tetris in a pane, played with letter hotkeys. No wallet required.

```
/plugin install slop-tetris --marketplace wobondar/claude-plugins
```

![slop-tetris: the well, hold and next, score, and the hotkey strip](assets/slop-tetris.png)

## Install

Answer `y` to add the marketplace the first time, then pick a scope. The marketplace is added once; later mods install with the same line and their own name.

## Develop

Every mod is a folder under `mods/` with its own README, tests and manifest.

```
claude plugin validate ./mods/<mod>
claude plugin test ./mods/<mod>
claude --plugin-dir ./mods/<mod>
```

## License

MIT
