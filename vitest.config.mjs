import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.{js,jsx}'],
        setupFiles: ['./tests/setup.js'],
        clearMocks: true,
        restoreMocks: true,
        maxWorkers: 2,
        // 테스트는 실제 프로젝트 키에 기대지 않는다. .env.local 없는 CI에서도 supabaseClient import가
        // 계약 검사(sb_publishable_ 형식)를 통과하도록 가짜 값을 고정한다. 네트워크는 각 테스트가 모킹한다.
        env: {
            VITE_SUPABASE_URL: 'https://example.invalid',
            VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_placeholder',
        },
    },
});
