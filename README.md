# claude-plugins

Mods for Claude Code: live panes, bands, status lines and hooks, written as plugins of function hooks that hot-reload while you work.

## Mods

| mod | what it is |
| --- | --- |
| [slop-machine](mods/slop-machine) | A three-reel slot machine above the prompt, paid in `󱚦` Claude Dollars you earn by prompting and Claude earns by calling tools. |

## Install

```
/plugin install slop-machine --marketplace wobondar/claude-plugins
```

Answer `y` to add the marketplace, then pick a scope. The marketplace is added once; later mods install with the same line and their own name.

## Develop

Every mod is a folder under `mods/` with its own README, tests and manifest.

```
claude plugin validate ./mods/<mod>
claude plugin test ./mods/<mod>
claude --plugin-dir ./mods/<mod>
```

## License

MIT
