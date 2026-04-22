# CLAUDE.md

Guidance for Claude (and any AI coding agent) working in this repo. Read this once per session before making changes.

## Repo identity

- **Name**: SweatRelay
- **Goal**: Bridge Chinese cycling platforms (Onelap 顽鹿, etc.) to Strava. Onelap killed its official Strava integration on 2026-03-19; this is the replacement plus a generic ride-file relay.
- **Distribution model**: Single-file binary CLI + Electron GUI installers via GitHub Releases. **No npm publication.** End users never touch Node/pnpm/bun.
- **Repo**: `xxxxxccc/SweatRelay` on GitHub.
- **Reference implementation**: `/Users/xuechen/Desktop/workspace/OnelapSyncStrava` is the prior Go version. Onelap private API details (MD5 sig, cookie session, secret) come from there — do not re-research.

## Hard rules — read these before writing any code

These are locked decisions from the user. Do not re-litigate or ignore.

### Runtimes & toolchain
- **Node 24+** (engines, .nvmrc, all CI). Local Node 22 still mostly works but 24 is the target.
- **TypeScript 6** (`^6.0.0`).
- **No build step for source TS** — Node 24's native type stripping handles it. ESM imports include `.ts` extensions.
- **Biome** for lint + format (not ESLint/Prettier). `semicolons: "asNeeded"` — never write trailing semis.
- **pnpm workspace**, never npm/yarn.

### Language conventions
- **No TypeScript `enum`** — ever. Use `const X = { ... } as const` + `type X = (typeof X)[keyof typeof X]`. Biome rule `style/noEnum` enforces this.
- **No parameter properties** (`constructor(private readonly x: T) {}`) — Node strip-only mode rejects them. Declare fields explicitly + assign in constructor body.

### GUI stack (locked)
- **electron-vite v5** + **Vite 7** + **Electron 40+**
- **React 19**
- **Tailwind v4** (CSS-first, `@theme` blocks, no `tailwind.config.js`)
- **Real shadcn/ui (Radix variant)** in `packages/gui/src/renderer/src/components/ui/` — owned files, Radix primitives, `class-variance-authority`, `lucide-react` icons. **Don't roll custom Base UI components**; use the shadcn registry pattern.
- **Race Telemetry aesthetic**: Bebas Neue display, Hanken Grotesk body, JetBrains Mono tabular, Noto Sans SC fallback. Strava orange `oklch(67% 0.215 41)` is the only accent — used sparingly for CTAs, active states, live indicators. Race-line marker (2px orange bar) on active nav. See `globals.css` for the token set: `--text-micro`, `--text-mini`, `--text-hero`, `--tracking-stamp`, `--tracking-stamp-wide`, `--tracking-stamp-mono`.
- **No arbitrary Tailwind values when a token exists**: use `text-micro` not `text-[10px]`, `tracking-stamp` not `tracking-[0.18em]`, `bg-linear-to-r` not `bg-gradient-to-r` (v4 canonical), `min-w-40` not `min-w-[160px]`, `p-px` not `p-[1px]`.
- **TanStack Router** (file-based, `routes/` dir, `routeTree.gen.ts` git-ignored). Never use React Router.
- **Jotai** for cross-component shared state. Plain `useState` for component-private UI state. Don't add Redux/Zustand. Context is only for true environment effects (theme, etc.), not data.
- **Both dark and light themes** are mandatory; persisted in `settings.json`; defaults to system. The `data-theme` attribute on `<html>` switches color tokens.
- **macOS frameless** with `titleBarStyle: 'hiddenInset'` — header padding `pl-19.5` reserves room for traffic lights; `app-region-drag` makes the title bar draggable, `app-region-no-drag` opts buttons back out.
- **No `React.FormEvent`** — use `React.SyntheticEvent` or specific event handler types (`React.FormEventHandler<HTMLFormElement>`).

### CLI distribution (locked)
- Built with **esbuild** (bundle to single CJS) + **Node SEA** (`--experimental-sea-config` + `postject`). Each platform builds its own binary; SEA cannot cross-compile.
- **Do NOT use `bun build --compile`** — bun fully disables SQLite extensions, and v0.3 plans on SQLite. Bun is forbidden as a build tool.
- For SQLite (v0.3+): use Node built-in `node:sqlite`, not `better-sqlite3`. Native modules + SEA = pain.

### Target platforms
- **Only macOS Apple Silicon and Windows x64.**
- No Linux. No Intel Mac. CI matrix, electron-builder config, install scripts, Homebrew formula — all reflect this. Don't re-add Linux without explicit user request.

### Storage & secrets
- Credentials live in `EncryptedFileCredentialStore` (AES-256-GCM + scrypt) at `$XDG_CONFIG_HOME/sweatrelay/creds.enc`.
- v0.3 will add `@napi-rs/keyring` (OS keychain) as the preferred path with the encrypted-file as fallback.
- **Never log or echo secrets.** Password prompts use no-echo TTY mode.

### Data sourcing policy
- Prefer official APIs.
- Where no official API exists (Onelap), use the community-known private API — but **always** also provide a file-import fallback. Never rely solely on the private path.
- Do not invent new reverse-engineering. If a new brand needs work, document the file-export path first.

### Updates & releases
- GUI auto-update: **electron-updater + GitHub Releases provider**. `package.json build.publish.owner` = `xxxxxccc`.
- CI workflows:
  - `ci.yml` — every PR: lint + typecheck + test
  - `main-build.yml` — every push to main: build all binaries, replace assets on `nightly` rolling pre-release
  - `release.yml` — `vX.Y.Z` tag: same artifacts, on the proper release
- Don't gate auto-build behind tags. Don't delete `main-build.yml`.

### Agent integration
- **No MCP server.** AI agents drive the CLI via [SKILL.md](./SKILL.md). Don't propose adding an MCP server.

## Repo layout

```
SweatRelay/
├── biome.json, tsconfig.base.json, pnpm-workspace.yaml, package.json
├── .github/workflows/{ci,main-build,release}.yml
├── scripts/
│   ├── install.sh, install.ps1
│   └── homebrew/sweatrelay.rb
├── README.md, SKILL.md, CLAUDE.md, AGENTS.md (-> CLAUDE.md)
└── packages/
    ├── core/                    # @sweatrelay/core   — only place business logic lives
    │   └── src/{activity,adapters,credentials,parsers,pipeline,state,triggers,uploader,util}/
    ├── adapter-folder/          # @sweatrelay/adapter-folder
    ├── adapter-onelap/          # @sweatrelay/adapter-onelap (API + folder dual impl)
    ├── cli/                     # @sweatrelay/cli  — cac framework, esbuild + SEA
    │   └── scripts/{bundle,build-binary}.mjs
    └── gui/                     # @sweatrelay/gui  — Electron 40 + React 19
        └── src/{main,preload,shared,renderer/src/{components,routes,state,lib,styles}}/
```

`packages/core` is the single source of truth for business logic. CLI and GUI are thin shells.

## Common tasks

### Add a new source adapter
1. New package `packages/adapter-<brand>/` with its own `package.json` + `tsconfig.json` extending the base
2. Implement `SourceAdapter` from `@sweatrelay/core/adapters`
3. If brand has no official API: prefer wrapping `@sweatrelay/adapter-folder` and labeling differently (see `OnelapFolderAdapter`)
4. Add unit tests with `undici` MockAgent
5. Wire into CLI (`packages/cli/src/commands/sync.ts`) and GUI (`packages/gui/src/main/services.ts`)
6. Update SKILL.md with the new commands

### Add a CLI command
- Add to `packages/cli/src/commands/`. Each command is a pure function calling `@sweatrelay/core`.
- Register in `packages/cli/src/index.ts` via cac.
- Update SKILL.md.

### Add a GUI route
- Drop a file in `packages/gui/src/renderer/src/routes/` — TanStack Router auto-generates the route tree.
- Read shared status via `useAtomValue(statusAtom)`. To trigger a status refresh, `useSetAtom(refreshStatusAtom)`.
- Page header: use `<SectionHeading index="0X" title="UPPERCASE NAME" subtitle="..." action={...} />`.
- Use the existing shadcn `ui/` primitives + the project micro-helpers (`<StatusDot />`, `<ElevationBackdrop />`). Don't roll new buttons/cards/inputs.
- Match the existing visual language: numbered section index in mono orange, Bebas Neue uppercase headings, micro-label tags in `text-micro uppercase tracking-stamp`, tabular numbers for any data, status indicators via `<StatusDot tone="live|success|warning|danger|idle" />`.
- Both light and dark must look right — toggle in Settings to verify.

### Bump runtime versions
- Single source: root `package.json` engines + `.nvmrc` + all `actions/setup-node` `node-version:` in workflows. Keep them in sync.

## Verifying changes

Before reporting "done":

```sh
pnpm lint        # biome check, must be 0 errors
pnpm typecheck   # tsc --noEmit across all packages
pnpm test        # vitest unit tests
```

For CLI binary changes:
```sh
pnpm --filter @sweatrelay/cli run bundle
pnpm --filter @sweatrelay/cli run build:binary
./packages/cli/dist/sweatrelay-darwin-arm64 --version
```

For GUI build smoke test:
```sh
pnpm --filter @sweatrelay/gui exec electron-vite build
```

For GUI manual test (requires display):
```sh
SWEATRELAY_PASSPHRASE=test pnpm --filter @sweatrelay/gui dev
```

## What NOT to do

- ❌ Add `enum` keyword anywhere. Biome will fail the lint.
- ❌ Suggest installing the CLI via `npm install -g`.
- ❌ Suggest using bun for binary distribution. Bun is fine for nothing in this project — neither dev nor build.
- ❌ Add Linux support without explicit user request.
- ❌ Re-introduce `tailwind.config.js`. v4 is config-less; design tokens go in CSS `@theme`.
- ❌ Use arbitrary Tailwind values when a project token exists (`text-[10px]` → `text-micro`, `tracking-[0.18em]` → `tracking-stamp`, `bg-gradient-to-r` → `bg-linear-to-r`, `min-w-[160px]` → `min-w-40`).
- ❌ Roll new "shadcn-style" components by hand. Add real shadcn registry components (Radix variant) via copy from <https://ui.shadcn.com>.
- ❌ Use `React.FormEvent` (deprecated) — use `React.SyntheticEvent` or `React.FormEventHandler<HTMLFormElement>`.
- ❌ Use React Router or React Context for cross-component data.
- ❌ Add `better-sqlite3`. Use `node:sqlite`.
- ❌ Add MCP server packaging. SKILL.md is the agent interface.
- ❌ Commit `routeTree.gen.ts`. It's generated.
- ❌ Write trailing semicolons in TS/JS.
- ❌ Use parameter properties in constructors.
- ❌ Strip `external_id` when uploading to Strava — server-side dedupe relies on it.
- ❌ Treat `DuplicateActivityError` or "Already synced" as failures. They are normal idempotent outcomes.

## When in doubt

Read the user-feedback memory at root project memory file and the linked feedback files. Each one captures a specific decision the user made and why. If something contradicts those memories, the memories win — or ask the user before deviating.
