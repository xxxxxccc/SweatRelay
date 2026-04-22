import { createRouter, RouterProvider } from '@tanstack/react-router'
import { Provider as JotaiProvider } from 'jotai'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeEffect } from '@/components/ThemeProvider'
import { routeTree } from './routeTree.gen.ts'
// Bundled fonts (no network / CSP friendly).
import '@fontsource/bebas-neue/400.css'
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './styles/globals.css'

const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <JotaiProvider>
      <ThemeEffect>
        <RouterProvider router={router} />
      </ThemeEffect>
    </JotaiProvider>
  </StrictMode>,
)
