# DeepSeek Harness

> **桌面应用由 [farhanic017](https://github.com/farhanic017) 构建** — 将基于网页的实时服务器移植为原生桌面应用（Electron）。网页 → 桌面 转换、安装程序和原生工作区集成 — 在 103° 高烧中倾注心血打造。
> 支持我的工作：**[Patreon — Farhanic](https://www.patreon.com/cw/Farhanic)** ❤️ — 您的捐助将助力桌面版的持续构建与更新。

[English](README.md) | 中文

DeepSeek Harness (`dsh`) 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。

它采用 **一切皆插件** 的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计在 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper) 中有描述。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，迭代迅速。**将会有破坏兼容性的变更。**

## 运行

### 桌面应用（Windows — 推荐）

**直接桌面，无需终端或浏览器。** Electron 应用在内部捆绑了实时服务器 — 双击即可运行。

1. **下载安装程序：** 前往 [**Releases**](https://github.com/farhanic017/deepseek-harness/releases) → `DeepSeek Harness Setup 0.8.0.exe`（96 MB）→ 安装
2. **启动** 开始菜单 / 桌面 — 应用在系统分配的端口上启动自己的实时服务器，并原生打开 harness UI。无需 `npx`，无需记住 `http://127.0.0.1:3080`。

从源码构建桌面版：

```sh
git clone https://github.com/farhanic017/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run build
pnpm --filter @deepseek-ai/dsh-electron exec electron-builder --win --x64  # → dist/installer/DeepSeek Harness Setup 0.8.0.exe
```

### 网页实时服务器（终端 + 浏览器）

原始网页流程仍然可用 — 桌面版只是将其封装：

**从 `npm`：**

```sh
npx @deepseek-ai/dsh web
```
启动 Web UI 实时服务器，默认服务于 `http://127.0.0.1:3080`。在浏览器中打开该地址。参阅 [Web UI 指南](docs/user/guide/index.md)。

**从源码：**

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
# 然后打开 http://127.0.0.1:3080
```

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或错误报告。
- 为您的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 主题以提高可发现性。
- 加入 <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord 社区</a>。

## 贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

从 [开发指南](docs/development.md) 和 [架构文档](docs/architecture.md) 开始。

对于 agents，请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中披露。
