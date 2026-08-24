# DeepSeek Harness

> **Desktop App by [farhanic017](https://github.com/farhanic017)** — Ported the web-based live server to a native desktop app (Electron). Web → Desktop conversion, installer, and native workspace integration — built with care while pushing through.
> Support the work: **[Patreon — Farhanic](https://www.patreon.com/cw/Farhanic)** ❤️ — donations keep the desktop builds and updates coming.

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Desktop App (Windows — Recommended)

**Direct desktop, no terminal or browser needed.** The Electron app bundles the live server internally — double-click and go.

1. **Download installer:** Go to [**Releases**](https://github.com/farhanic017/deepseek-harness/releases) → `DeepSeek Harness Setup 0.8.0.exe` (96 MB) → install
2. **Launch** from Start Menu / Desktop — the app starts its own live server on an OS-assigned port and opens the harness UI natively. No `npx`, no `http://127.0.0.1:3080` to remember.

Build the desktop from source:

```sh
git clone https://github.com/farhanic017/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run build        # web + main/preload
pnpm --filter @deepseek-ai/dsh-electron exec electron-builder --dir --win --x64  # unpacked
# or full installer:
pnpm --filter @deepseek-ai/dsh-electron exec electron-builder --win --x64  # → dist/installer/DeepSeek Harness Setup 0.8.0.exe
```

### Run the Web Live Server (Terminal + Browser)

The original web flow still works — the desktop just wraps it:

**From `npm`:**

```sh
npx @deepseek-ai/dsh web
```
Starts the Web UI live server, served at `http://127.0.0.1:3080` by default. Open that address in your browser. See [Web UI guide](docs/user/guide/index.md).

**From source:**

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
# then open http://127.0.0.1:3080
```

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
