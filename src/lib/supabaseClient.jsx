
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// 공개 클라이언트 키는 이 변수 하나만 사용한다.
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY



if (!supabaseUrl || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabasePublishableKey || '')) {
    throw new Error('VITE_SUPABASE_URL and an active VITE_SUPABASE_PUBLISHABLE_KEY are required.');
}
let client;

if (import.meta.env.DEV) {
    // 개발 환경: HMR 대응을 위해 globalThis에 인스턴스를 캐싱
    if (!globalThis.__supabaseClient) {
        globalThis.__supabaseClient = createClient(supabaseUrl, supabasePublishableKey);
    }
    client = globalThis.__supabaseClient;
} else {
    // 프로덕션 환경: 단일 인스턴스 생성
    client = createClient(supabaseUrl, supabasePublishableKey);
}

export const supabase = client;
