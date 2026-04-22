# Homebrew tap one-time setup

The release workflow can auto-publish a Homebrew formula to a separate **tap repository**. This is gated behind a repo variable so it stays off until the tap exists.

## One-time setup (do this once)

### 1. Create the tap repository

On GitHub, create a public repo at `xxxxxccc/homebrew-sweatrelay`. The name **must** start with `homebrew-` — Homebrew's tap discovery requires it.

Initial contents (one-time):

```
homebrew-sweatrelay/
├── README.md         # 简单一行说明
└── Formula/
    └── .gitkeep      # 空目录占位，CI 会写 Formula/sweatrelay.rb
```

### 2. Create a fine-grained PAT

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token:

- **Resource owner**: your account
- **Repository access**: only `xxxxxccc/homebrew-sweatrelay`
- **Permissions** → Repository permissions:
  - Contents: Read and write

Copy the token (it shows once).

### 3. Wire it into this repo

In `xxxxxccc/SweatRelay`:

- Settings → Secrets and variables → Actions → **New repository secret**
  - Name: `HOMEBREW_TAP_TOKEN`
  - Value: the PAT from step 2
- Settings → Secrets and variables → Actions → Variables tab → **New repository variable**
  - Name: `HOMEBREW_ENABLED`
  - Value: `true`

### 4. Cut a release

Tag and push: `git tag v0.1.0 && git push --tags`. The release workflow runs the `homebrew` job, computes the sha256 of `sweatrelay-darwin-arm64`, patches `scripts/homebrew/sweatrelay.rb`, and commits to the tap.

Users can then install via:

```sh
brew install xxxxxccc/sweatrelay/sweatrelay
```

## Why a separate repo?

Homebrew taps must be standalone repos named `homebrew-*`. We ship the formula source-of-truth in this repo (`scripts/homebrew/sweatrelay.rb`) and the workflow keeps the tap mirror updated.

## Disabling

Unset the `HOMEBREW_ENABLED` variable (or set to anything other than `true`). The `homebrew` job will skip on subsequent releases.
