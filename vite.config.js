import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the app under /vratime-app/, while the custom domain
  // serves it from /. Keep this explicit so both release targets stay valid.
  base: process.env.VITE_PUBLIC_BASE ?? (process.env.GITHUB_ACTIONS ? '/vratime-app/' : '/'),
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'VratiMe',
        short_name: 'VratiMe',
        description: 'Give packaging and materials another life in Montenegro',
        theme_color: '#087783',
        background_color: '#effafa',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'app-logo-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'app-logo-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
