import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        // node:sqlite is a brand-new built-in (22.5+); make sure Vite/Vitest
        // doesn't try to bundle/resolve it as a userland module.
        external: [/^node:/],
      },
    },
  },
})
