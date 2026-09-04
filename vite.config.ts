import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Aceita SUPABASE_URL / SUPABASE_ANON_KEY (sem prefixo, para hosts como a Vercel que
  // tratam VITE_* como público) e cai para VITE_* (.env.local). Ambos vao para o bundle:
  // sao a URL do projeto e a anon key, feitas para o cliente — a seguranca fica no RLS.
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? ''
  const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? ''
  // Chave pública VAPID (Web Push). Opcional: sem ela o botão de notificações fica oculto.
  const vapidPublicKey = env.VAPID_PUBLIC_KEY ?? env.VITE_VAPID_PUBLIC_KEY ?? ''
  console.log(
    `[songsfy] Supabase no build: url=${supabaseUrl ? supabaseUrl : 'AUSENTE'} · anonKey=${supabaseAnonKey ? 'ok' : 'AUSENTE'}`,
  )

  return {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(vapidPublicKey),
    },
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
          display_override: ['standalone'],
          orientation: 'portrait',
          start_url: '/',
          id: '/',
          scope: '/',
          // Atalhos ao segurar o ícone na tela inicial (Android/desktop). O `?screen=`
          // é consumido por initialScreen() em src/App.tsx.
          shortcuts: [
            { name: 'Música do Dia', short_name: 'Música', url: '/?screen=single' },
            { name: 'Capa do Dia', short_name: 'Capa', url: '/?screen=cover' },
            { name: 'Amigos', short_name: 'Amigos', url: '/?screen=friends' },
          ],
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Handler de Web Push (public/push-sw.js) anexado ao SW gerado pelo Workbox
          importScripts: ['push-sw.js'],
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
  }
})
