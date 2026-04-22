import { createRequire } from 'node:module'

/**
 * Returns a `require` function usable from both ESM source (where `import.meta.url`
 * is set) and bundled CJS (where `__filename` exists but `import.meta.url` is
 * undefined). Lets us load Node built-ins like `node:sqlite` without tripping
 * over Vite/Vitest static-analysis or esbuild's CJS output quirks.
 */
export function dynamicRequire(): NodeJS.Require {
  // CJS context after esbuild bundling
  if (typeof __filename !== 'undefined') return createRequire(__filename)
  // ESM source — TypeScript may complain about top-level import.meta in some
  // module modes, but at runtime in ESM `import.meta.url` is always set.
  const metaUrl = (import.meta as ImportMeta).url
  return createRequire(metaUrl)
}
