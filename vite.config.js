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
                manifest: false,  // manifest는 public/manifest.json, public/manifest-kiosk.json으로 직접 관리
                workbox: {
                    // [PERF] Supabase Storage 이미지 CacheFirst → 재방문 즉시 썸네일 표시
                    runtimeCaching: [
                        {
                            urlPattern: ({ url }) =>
                                url.hostname.endsWith('supabase.co') && url.pathname.includes('/storage/v1/object/public/'),
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'supabase-images',
                                expiration: {
                                    maxEntries: 400,
                                    maxAgeSeconds: 60 * 60 * 24 * 30 // 30일
                                },
                                cacheableResponse: { statuses: [0, 200] }
                            }
                        },
                        {
                            urlPattern: ({ url }) => url.hostname === 'cf.geekdo-images.com',
                            handler: 'CacheFirst',
                            options: {
                                cacheName: 'bgg-images',
                                expiration: {
                                    maxEntries: 400,
                                    maxAgeSeconds: 60 * 60 * 24 * 30
                                },
                                cacheableResponse: { statuses: [0, 200] }
                            }
                        }
                    ]
                }
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
                    configure: (proxy, _options) => {
                        proxy.on('proxyReq', (proxyReq, req, _res) => {
                            const bggToken = env.VITE_BGG_API_TOKEN
                            if (bggToken) {
                                proxyReq.setHeader('Authorization', `Bearer ${bggToken}`)
                            }
                        })
                    },
                },
                '/bgg-thing': {
                    target: 'https://boardgamegeek.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/bgg-thing/, '/xmlapi2/thing'),
                    configure: (proxy, _options) => {
                        proxy.on('proxyReq', (proxyReq, req, _res) => {
                            const bggToken = env.VITE_BGG_API_TOKEN
                            if (bggToken) {
                                proxyReq.setHeader('Authorization', `Bearer ${bggToken}`)
                            }
                        })
                    },
                },
            },
        },
        build: {
            outDir: 'build',
            rollupOptions: {
                output: {
                    manualChunks: {
                        // React 런타임 (가장 안정적, 최장 캐시)
                        react: ['react', 'react-dom'],
                        // 라우터는 런타임과 분리 (router 업데이트 시 react 청크 그대로 재사용)
                        router: ['react-router-dom'],
                        // Supabase SDK (무거움, 별도)
                        supabase: ['@supabase/supabase-js'],
                        // recharts는 StatsTab에서만 쓰므로 manualChunks 없이도 Admin 청크에 포함됨 - 그대로 둠
                    }
                }
            }
        },
    }
})
