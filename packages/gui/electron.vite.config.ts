import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig(({ command }) => ({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          '@sweatrelay/core',
          '@sweatrelay/adapter-onelap',
          '@sweatrelay/adapter-folder',
          '@sweatrelay/adapter-blackbird',
          '@sweatrelay/adapter-magene',
        ],
      },
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [
      tanstackRouter({
        routesDirectory: resolve('src/renderer/src/routes'),
        generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts'),
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    define: {
      __IS_PACKAGED__: JSON.stringify(command === 'build'),
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
}))
