#!/usr/bin/env node
/**
 * Bundle the CLI to a single CommonJS file with esbuild.
 * The output is the input for SEA injection (see build-binary.mjs).
 *
 * We target CJS because Node SEA's main script support for ESM still requires
 * `useSnapshot: false` AND has rough edges with top-level await; CJS is rock-
 * solid. esbuild handles ESM → CJS internally.
 */
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '..')

await build({
  entryPoints: [resolve(cliRoot, 'src/index.ts')],
  outfile: resolve(cliRoot, 'dist/sweatrelay.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  minify: true,
  sourcemap: false,
  // Node built-ins are available at runtime; let esbuild treat them as external.
  external: [],
  // No shebang here — SEA's V8 code-cache step rejects non-JS bytes at the top.
  // The produced binary is invoked directly, not via shebang dispatch.
  legalComments: 'none',
  logLevel: 'info',
})

console.log('✓ bundled → packages/cli/dist/sweatrelay.cjs')
