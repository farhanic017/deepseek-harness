# DeepSeek Harness

> **桌面应用由 [farhanic017](https://github.com/farhanic017) 构建** — 将基于网页的实时服务器移植为原生桌面应用（Electron）。网页 → 桌面 转换、安装程序和原生工作区集成 — 在 103° 高烧中倾注心血打造。
> 支持我的工作：**[Patreon — Farhanic](https://www.patreon.com/cw/Farhanic)** ❤️ — 您的捐助将助力桌面版的持续构建与更新。

[English](README.md) | 中文

DeepSeek Harness (`dsh`) 是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。

它采用 **一切皆插件** 的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计在 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper) 中有描述。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，迭代迅速。**将会有破坏兼容性的变更。**

## 运行

### 桌面应用（Windows）

**无需终端或浏览器。** 下载后双击即可：

1. 前往 [**Releases**](https://github.com/farhanic017/deepseek-harness/releases) → `DeepSeek Harness Setup 0.8.0.exe`（96 MB）→ 安装
2. 从开始菜单启动 — 应用在内部启动实时服务器并原生打开 harness UI。

## 新功能（桌面版）

- **工作区卸载/分离** — 无需删除磁盘文件即可从列表中移除任意工作区。Hero 区的芯片旁会出现 **×** 按钮用于分离当前工作区，侧边栏顶部也有 **垃圾桶** 按钮可移除选中的工作区。旧的 `选择工作区` 阻塞已移除 — 即使未选择文件夹也能立即聊天。
- **插件开关切换，无需打开配置文件** — 直接在 UI（侧边栏/插件清单）中切换任意插件的启用/禁用 — 无需编辑 `cordis.yml` 或 `package.json`，改动实时生效。
- **模型选择器中的搜索栏** — 在编辑器模型下拉框（发送按钮左侧）中即时筛选模型。有无工作区均可使用，即使出现模型相关的阻塞提示，编辑器仍保持可用。

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
