import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // AI SDK packages are ESM-first — bundle them into the main build instead of
    // externalizing, so Electron's CJS main process can load them.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          'ai',
          '@ai-sdk/anthropic',
          '@ai-sdk/openai',
          '@ai-sdk/google',
          '@ai-sdk/openai-compatible',
          'marked' // ESM-only, must be bundled too
        ]
      })
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
