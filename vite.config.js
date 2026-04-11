import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    return {
        plugins: [
            react(),
            VitePWA({
                registerType: 'autoUpdate',
                devOptions: {
                    enabled: false
                },
                manifest: false  // manifest는 public/manifest.json, public/manifest-kiosk.json으로 직접 관리
            })
        ],
        envPrefix: ['VITE_'],
        server: {
            port: 3000,
            proxy: {
                '/v1': {
                    target: 'https://openapi.naver.com',
                    changeOrigin: true,
                    // v1 is kept in path, so no rewrite needed typically if target is openapi.naver.com
                    // But original proxy had target 'https://openapi.naver.com/v1', so we need to be careful.
                    // Original: target: 'https://openapi.naver.com/v1', path: '/v1' -> result: 'https://openapi.naver.com/v1/v1...' if not handled?
                    // Express proxy default behavior: /v1/search -> https://target/v1/search
                    // Let's match typical Vite behavior.
                    rewrite: (path) => path.replace(/^\/v1/, '/v1'), // maintain /v1
                    configure: (proxy, _options) => {
                        proxy.on('proxyReq', (proxyReq, req, _res) => {
                            const clientId = env.VITE_NAVER_CLIENT_ID
                            const clientSecret = env.VITE_NAVER_CLIENT_SECRET
                            if (clientId && clientSecret) {
                                proxyReq.setHeader('X-Naver-Client-Id', clientId)
                                proxyReq.setHeader('X-Naver-Client-Secret', clientSecret)
                                // console.log(`[Proxy] API Key injected for ${req.url}`)
                            }
                        })
                    },
                },
                '/bgg-search': {
                    target: 'https://boardgamegeek.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/bgg-search/, '/xmlapi2/search'),
                },
                '/bgg-thing': {
                    target: 'https://boardgamegeek.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/bgg-thing/, '/xmlapi2/thing'),
                },
            },
        },
        build: {
            outDir: 'build',
            rollupOptions: {
                output: {
                    manualChunks: {
                        vendor: ['react', 'react-dom', 'react-router-dom'],
                        supabase: ['@supabase/supabase-js']
                    }
                }
            }
        },
    }
})
