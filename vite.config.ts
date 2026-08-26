import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // host: true → escuta em todas as interfaces (IPv4 incluso); sem isso, no Windows
  // o Vite pode subir só em [::1] (IPv6) e o ngrok, que disca 127.0.0.1, é recusado
  // Proxy same-origin para a iTunes API: usado como último recurso quando a CDN
  // da Apple serve respostas vazias para a rede do cliente (bug conhecido da API)
  server: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    proxy: {
      '/itunes': {
        target: 'https://itunes.apple.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/itunes/, ''),
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
    proxy: {
      '/itunes': {
        target: 'https://itunes.apple.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/itunes/, ''),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Songsfy — Jogos de Música',
        short_name: 'Songsfy',
        description: 'Um jogo musical por dia: ouça a prévia e adivinhe a música!',
        lang: 'pt-BR',
        theme_color: '#1c0c14',
        background_color: '#1c0c14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API do iTunes: rede primeiro, cache como fallback offline
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/itunes\.apple\.com\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'itunes-api',
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Capas de álbum e prévias de áudio
            urlPattern: /^https:\/\/.*\.mzstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'itunes-assets',
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 86400 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
