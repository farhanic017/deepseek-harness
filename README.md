# DeepSeek Harness

> **Desktop App by [farhanic017](https://github.com/farhanic017)** — Ported the web-based live server to a native desktop app (Electron). Web → Desktop conversion, installer, and native workspace integration — built with care while pushing through.
> Support the work: **[Patreon — Farhanic](https://www.patreon.com/cw/Farhanic)** ❤️ — donations keep the desktop builds and updates coming.

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Desktop App (Windows)

**No terminal, no browser.** Download and double-click:

1. Go to [**Releases**](https://github.com/farhanic017/deepseek-harness/releases) → `DeepSeek Harness Setup 0.8.0.exe` (96 MB) → install
2. Launch from Start Menu — the app starts its own live server internally and opens the harness UI natively.

## New Features (Desktop)

- **Workspace unmount/detach** — Remove any workspace from the list without deleting files on disk. Hero chip now shows a **×** to detach the current workspace, and the sidebar header has a **trash** button to remove selected workspaces. The old `Choose a workspace` gate is gone — chat works immediately even with no folder picked.
- **Plugins on/off toggle without opening configuration files** — Toggle any plugin directly from the UI (sidebar/plugin inventory) — no need to edit `cordis.yml` or `package.json`. Changes apply live.
- **Search bar in model selector** — Filter models instantly in the composer’s model dropdown (left of Send). Works with or without a workspace, and keeps the composer live even when a model block is raised.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
