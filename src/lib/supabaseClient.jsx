
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY



if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase URL or Key is missing! Check your .env file or Vite config envPrefix.');
}
let client;

if (import.meta.env.DEV) {
    // 개발 환경: HMR 대응을 위해 globalThis에 인스턴스를 캐싱
    if (!globalThis.__supabaseClient) {
        globalThis.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    }
    client = globalThis.__supabaseClient;
} else {
    // 프로덕션 환경: 단일 인스턴스 생성
    client = createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = client;
