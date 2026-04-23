# SweatRelay

把国内不支持 Strava 同步的骑行平台数据，自动同步到 Strava。

[![CI](https://github.com/xxxxxccc/SweatRelay/actions/workflows/ci.yml/badge.svg)](https://github.com/xxxxxccc/SweatRelay/actions/workflows/ci.yml)

## 它能做什么

- **Onelap → Strava**：用账号密码自动拉取今日骑行
- **任意码表 → Strava**：监控一个文件夹，新增的 FIT/GPX/TCX 自动上传
- **定时拉取**：GUI 里挑频率（每 15 分钟 / 每小时…）；CLI 支持 cron 表达式
- **同步控制台**：GUI 和 CLI 共享同一套本地配置、凭证和同步历史
- **重复检测**：本地 hash + Strava 服务端 `external_id` 双保险，重复上传不会真重复
- **加密存储**：所有连接信息用 AES-256-GCM + scrypt 加密在本地（支持 OS 钥匙串）

## 安装

**支持平台**：macOS Apple Silicon 和 Windows x64。Intel Mac 和 Linux 暂不提供预编译产物——可以从源码构建（见下方"开发"）。

### CLI（推荐：单文件二进制）

```sh
# macOS (Apple Silicon)
curl -fsSL https://raw.githubusercontent.com/xxxxxccc/SweatRelay/main/scripts/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/xxxxxccc/SweatRelay/main/scripts/install.ps1 | iex
```

或者手动从 [Releases](https://github.com/xxxxxccc/SweatRelay/releases) 下载对应平台的二进制，`chmod +x` 后放进 `$PATH`。

### GUI

从 [Releases](https://github.com/xxxxxccc/SweatRelay/releases) 下载：
- macOS Apple Silicon：`.dmg`
- Windows：`.exe`

GUI 内置自动升级（electron-updater + GitHub Releases）。

首次打开时，**macOS / Windows 都可能因为应用未签名而拦截**：

- **macOS**：如果提示“已损坏，无法打开”或直接拒绝启动，把 App 拖到 `/Applications` 后执行：

```sh
xattr -dr com.apple.quarantine /Applications/SweatRelay.app
```

然后再打开一次。

- **Windows**：第一次运行安装包或应用时，可能出现 SmartScreen 的“Windows 已保护你的电脑”。点“更多信息” → “仍要运行”即可。

如果是下载文件本身被标记，也可以在 PowerShell 里解除阻止：

```powershell
Unblock-File "$env:USERPROFILE\\Downloads\\SweatRelay Setup 0.0.3.exe"
```

如果你把安装器放在别的目录，改成对应路径即可。

## 快速开始

### 1. 准备 Strava API 凭证

到 <https://www.strava.com/settings/api> 创建一个 API 应用：
- Authorization Callback Domain 必须设为 `localhost`
- 拿到 `Client ID` 和 `Client Secret`

### 2. CLI 用法

```sh
# 首次使用 CLI 时建议先提供本地加密密码
export SWEATRELAY_PASSPHRASE="your-master-password"

# 可选：用环境变量覆盖 Strava App 配置
# 如果你已经在 GUI 里配过一次，这两项可以不设
export STRAVA_CLIENT_ID="..."
export STRAVA_CLIENT_SECRET="..."

# 一次性授权
sweatrelay auth strava        # 浏览器 OAuth
sweatrelay auth onelap        # 输入 Onelap 账号密码

# 三种用法

# 1) 一次性同步今日 Onelap
sweatrelay sync onelap --since today

# 2) 文件夹监听（任意码表导出目录）
sweatrelay watch ~/Downloads/rides

# 3) 定时
sweatrelay schedule "*/30 * * * *" sync onelap --tz Asia/Shanghai

# 查看历史
sweatrelay status
sweatrelay doctor
```

说明：

- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` 现在只是 **override**。未设置时，CLI 会回落到 GUI/CLI 共享的本地持久化配置。
- 如果你既没有启用文件夹监控，也没有配置定时同步，那么 **手动执行 `sweatrelay sync onelap` 就是唯一同步方式**。

完整命令参考见 [SKILL.md](./SKILL.md)（也是给 AI agent 用的）。

### 3. GUI 用法

启动后跟着引导走：填本地加密密码 + Strava 凭证 → 授权 Strava → 配置 Onelap 账号或选 watch 目录 → 看 Dashboard。

GUI 现在按“同步控制台”来设计：

- `Strava` 是唯一原生目标端
- `Intervals.icu` 只提供外部服务入口，不在应用内直连上传
- `文件夹监控` 和 `定时同步` 都属于后台自动同步
- 如果这两项都没启用，右上角的 `立即同步` 就是当前唯一同步方式

如果你也使用 `Intervals.icu`，推荐路径是：

1. 用 SweatRelay 把活动同步到 `Strava`
2. 在 `Intervals.icu` 那边连接 `Strava`
3. 让 `Intervals.icu` 经由 `Strava` 获取活动

支持 dark / light 主题切换。

## 数据来源策略

- **优先官方开放平台**
- **没有官方接口的品牌**（如 Onelap，2026-03 后失去官方 Strava 通道）使用社区已知的私有接口；同时**始终提供文件导入兜底**
- **绝不逆向 App 内部加密 / 抓包破解**

每个 adapter 都标注来源类型（official / file-import / reverse-engineered），见各 adapter README。

## 架构

monorepo（pnpm workspace）：

```
packages/
├── core/                 # @sweatrelay/core         — 唯一业务逻辑层
├── adapter-folder/       # @sweatrelay/adapter-folder    — 通用文件夹源
├── adapter-onelap/       # @sweatrelay/adapter-onelap    — Onelap API + folder 双实现
├── adapter-magene/       # @sweatrelay/adapter-magene    — 迈金（文件导入）
├── adapter-blackbird/    # @sweatrelay/adapter-blackbird — 黑鸟单车（文件导入）
├── cli/                  # @sweatrelay/cli          — Node SEA 单文件二进制
└── gui/                  # @sweatrelay/gui          — Electron 40 + React 19
```

**核心抽象**（`@sweatrelay/core`）：
- `SourceAdapter` — 从源平台拉取活动
- `Activity` — 标准化数据模型（FIT 忠实）
- `StravaUploader` — 上传 + 异步轮询 + 限流退避 + 重复检测
- `Trigger` — 三种实现：`ManualTrigger` / `ScheduledTrigger`(cron) / `FileWatcherTrigger`(chokidar)
- `CredentialStore` — `EncryptedFileCredentialStore`(AES-GCM + scrypt) / `MemoryCredentialStore`(测试)
- `SyncPipeline` — 编排 trigger → adapter → upload → record

**CLI 与 GUI 共享同一份 core，也共享同一套本地配置、凭证与同步历史**。CLI 是薄壳（cac framework），GUI 是 Electron main 进程跑 core + React 19 渲染层（TanStack Router 文件路由 + Jotai 共享状态 + Tailwind v4 + shadcn/ui + Race Telemetry 视觉风格）。

## 开发

### 要求

- Node 24+（原生 TypeScript type stripping，默认无需 flag）
- pnpm 10+

### 安装与本地命令

```sh
nvm use && pnpm install

# 全部包并行 lint / typecheck / test
pnpm lint
pnpm typecheck
pnpm test

# 跑 CLI 源码（开发时用）
pnpm cli auth strava
pnpm cli sync onelap

# 跑 GUI dev server（含 hot-reload）
pnpm --filter @sweatrelay/gui dev

# 打包 CLI 二进制（host 平台）
pnpm --filter @sweatrelay/cli run bundle      # esbuild 单文件
pnpm --filter @sweatrelay/cli run build:binary # → Node SEA 二进制

# 打包 GUI 安装器（host 平台）
pnpm --filter @sweatrelay/gui run package
```

### 工具链选择

| 域 | 选择 | 理由 |
|---|---|---|
| Lint / Format | Biome | ESLint+Prettier 的更快替代，单一配置 |
| 包管理 | pnpm workspace | monorepo + 严格依赖 |
| Lang | TypeScript 6 + Node 原生 type stripping | 无 build step，import 都带 `.ts` 后缀 |
| CLI 框架 | cac | 最小，易二次包装 |
| GUI 模板 | electron-vite v5 + Vite 7 | Electron + React + ESM 现代栈 |
| GUI 状态 | Jotai | 原子粒度订阅 |
| GUI 路由 | TanStack Router (file-based) | 端到端类型安全 |
| GUI 样式 | Tailwind v4 + shadcn (Radix) | CSS-first 配置|
| 二进制分发 | Node SEA + esbuild + postject | 官方原生方案 |
| 自动升级 | electron-updater + GitHub Releases provider | 不依赖额外服务 |
| 测试 | vitest + undici MockAgent | 快、ESM 友好 |

详细设计决策见各 [memory feedback files](https://github.com/xxxxxccc/SweatRelay/tree/main/.claude)（开发者参考）。

### CI / 发布

- **`.github/workflows/ci.yml`** — 每个 PR / push：lint + typecheck + test
- **`.github/workflows/release.yml`** — 推 tag `vX.Y.Z`：构建 CLI 二进制和 GUI 安装器，发到正式 release（GUI 同时通过 electron-builder 上传 `latest*.yml` 给 electron-updater）

## 法律与风险

- **Strava OAuth** 走官方流程；上传遵守官方限流
- **Onelap API 路径** 基于社区已知的私有接口；接口随版本可能变化。仅供个人/教育用途。如不接受此风险，请使用文件夹路径
- **文件夹路径** 完全合规：你自己导出 FIT，工具只做转储
- 凭证全部本地加密存储，不上传任何第三方

## 贡献

PR welcome。请先：
- `pnpm lint && pnpm typecheck && pnpm test` 全绿
- 新 adapter 必须实现 `SourceAdapter` 接口、加单测、在 README 标注来源类型

## License

MIT
