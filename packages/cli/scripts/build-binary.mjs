#!/usr/bin/env node
/**
 * Produce a self-contained `sweatrelay` executable for the host platform using
 * Node 22+ Single Executable Applications (SEA).
 *
 * Pipeline:
 *   1. esbuild bundles src/index.ts → dist/sweatrelay.cjs (run `bundle` first)
 *   2. Generate SEA blob from sea-config.json
 *   3. Copy current node binary
 *   4. Inject blob with postject
 *   5. (macOS) re-sign with ad-hoc signature so Gatekeeper doesn't reject
 *
 * SEA cannot cross-compile — each OS/arch must build on its own runner.
 * CI matrix handles that; locally this produces the host binary only.
 *
 * Output: packages/cli/dist/sweatrelay-<os>-<arch>(.exe)
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '..')
const distDir = resolve(cliRoot, 'dist')
const bundlePath = resolve(distDir, 'sweatrelay.cjs')
const blobPath = resolve(distDir, 'sweatrelay.blob')
const seaConfigPath = resolve(distDir, 'sea-config.json')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')} exited ${r.status}`)
    process.exit(r.status ?? 1)
  }
}

function detectTarget() {
  const platform = process.platform // darwin | linux | win32
  const arch = process.arch // arm64 | x64
  const os = platform === 'win32' ? 'windows' : platform
  const ext = platform === 'win32' ? '.exe' : ''
  return { os, arch, ext, name: `sweatrelay-${os}-${arch}${ext}` }
}

function ensureBundle() {
  if (existsSync(bundlePath) && statSync(bundlePath).size > 0) return
  console.log('→ bundle missing, running esbuild bundle first')
  run(process.execPath, [resolve(__dirname, 'bundle.mjs')])
  if (!existsSync(bundlePath)) {
    console.error(`✗ bundle did not produce ${bundlePath}`)
    process.exit(1)
  }
}

function writeSeaConfig() {
  const cfg = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
  }
  writeFileSync(seaConfigPath, JSON.stringify(cfg, null, 2))
}

function generateBlob() {
  console.log('→ generating SEA blob')
  run(process.execPath, ['--experimental-sea-config', seaConfigPath])
}

function copyNodeBinary(target) {
  const dest = resolve(distDir, target.name)
  console.log(`→ copying node → ${dest}`)
  copyFileSync(process.execPath, dest)
  if (target.os !== 'windows') {
    spawnSync('chmod', ['+x', dest])
  }
  return dest
}

function injectBlob(target, dest) {
  console.log('→ injecting SEA blob with postject')
  const args = [
    'postject',
    dest,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ]
  if (target.os === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA')
  }
  run('npx', ['--yes', ...args])
}

function adhocSignDarwin(dest) {
  if (process.platform !== 'darwin') return
  console.log('→ ad-hoc re-signing (codesign --sign -)')
  // Strip any inherited signature first; ad-hoc sign so Gatekeeper accepts launch
  spawnSync('codesign', ['--remove-signature', dest])
  run('codesign', ['--sign', '-', '--force', dest])
}

function main() {
  mkdirSync(distDir, { recursive: true })
  ensureBundle()
  const target = detectTarget()
  writeSeaConfig()
  generateBlob()
  const dest = copyNodeBinary(target)
  injectBlob(target, dest)
  adhocSignDarwin(dest)
  console.log(`\n✓ produced ${dest}`)
  console.log(`  size: ${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB`)
}

main()
