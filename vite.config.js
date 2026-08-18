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
                '/naver-image-search': {
                    target: 'https://naverapihub.apigw.ntruss.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/naver-image-search/, '/search/v1/image'),
                    configure: (proxy, _options) => {
                        proxy.on('proxyReq', (proxyReq) => {
                            const clientId = env.NAVER_API_HUB_CLIENT_ID
                            const clientSecret = env.NAVER_API_HUB_CLIENT_SECRET
                            if (clientId && clientSecret) {
                                proxyReq.setHeader('X-NCP-APIGW-API-KEY-ID', clientId)
                                proxyReq.setHeader('X-NCP-APIGW-API-KEY', clientSecret)
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
                            const bggToken = env.BGG_API_TOKEN
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
                            const bggToken = env.BGG_API_TOKEN
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
