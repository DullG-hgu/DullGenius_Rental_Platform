
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
// Supabase의 현재 공개 클라이언트 키 이름을 우선 사용한다.
// 기존 배포 환경이 VITE_SUPABASE_ANON_KEY에 publishable 키를 넣어둔 경우도
// 중단 없이 이동할 수 있도록 변수명만 한시적으로 호환한다.
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || import.meta.env.VITE_SUPABASE_ANON_KEY



if (!supabaseUrl || !supabasePublishableKey) {
    console.error('Supabase URL or Key is missing! Check your .env file or Vite config envPrefix.');
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
