import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'VratiMe',
        short_name: 'VratiMe',
        description: 'Платформа обмена вторсырьем в Черногории',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/src/assets/images/app-logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/src/assets/images/app-logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/src/assets/images/app-logo.png',
            sizes: '180x180',
            type: 'image/png',
          },
          {
            src: '/src/assets/images/app-logo.png',
            sizes: '256x256',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
