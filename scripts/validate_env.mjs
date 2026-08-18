import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

const root = process.cwd();

// npm build에서도 Vite와 같은 로컬 env를 검사하되, 이미 주입된 값은 덮어쓰지 않는다.
for (const file of ['.env', '.env.local']) {
  const envPath = path.join(root, file);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
}

const strict = process.argv.includes('--strict') || process.env.NETLIFY === 'true';
const errors = [];
const warnings = [];

const requiredForClient = ['VITE_SUPABASE_URL'];
const requiredForKiosk = ['KIOSK_EMAIL', 'KIOSK_PASSWORD', 'KIOSK_MASTER_KEY'];
const requiredForNaverImage = ['NAVER_API_HUB_CLIENT_ID', 'NAVER_API_HUB_CLIENT_SECRET'];
const requiredForBgg = ['BGG_API_TOKEN'];
const forbiddenPublicSecrets = [
  'VITE_KIOSK_EMAIL',
  'VITE_KIOSK_PASSWORD',
  'VITE_KIOSK_MASTER_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_NAVER_CLIENT_SECRET',
  'VITE_DISCORD_WEBHOOK_URL',
  'VITE_BGG_API_TOKEN',
];

for (const key of requiredForClient) {
  if (!process.env[key]) errors.push(`${key} is required`);
}

const publicSupabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY;

if (!publicSupabaseKey) {
  errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is required (VITE_SUPABASE_ANON_KEY is accepted during migration)');
} else if (publicSupabaseKey.startsWith('eyJ')) {
  // 이 프로젝트에서는 legacy JWT anon 키가 비활성화되어 로그인까지 전부 401이 된다.
  (strict ? errors : warnings).push('legacy JWT-style Supabase anon key detected; use the active sb_publishable_ key');
} else if (!publicSupabaseKey.startsWith('sb_publishable_')) {
  warnings.push('Supabase client key does not use the expected sb_publishable_ format');
}

for (const key of requiredForKiosk) {
  if (!process.env[key]) (strict ? errors : warnings).push(`${key} is required for kiosk-session`);
}

for (const key of requiredForNaverImage) {
  if (!process.env[key]) (strict ? errors : warnings).push(`${key} is required for NAVER API HUB image search`);
}

for (const key of requiredForBgg) {
  if (!process.env[key]) (strict ? errors : warnings).push(`${key} is required for BGG search`);
}

for (const key of forbiddenPublicSecrets) {
  if (process.env[key]) (strict ? errors : warnings).push(`${key} must use a server-only variable name`);
}

if (process.env.KIOSK_MASTER_KEY && process.env.KIOSK_MASTER_KEY.length < 32) {
  // 기존 운영 키를 즉시 차단하지는 않되, 다음 회전 때 반드시 교체하게 경고한다.
  warnings.push('KIOSK_MASTER_KEY should be at least 32 characters');
}

if (process.env.KIOSK_MASTER_KEY_PREVIOUS
  && process.env.KIOSK_MASTER_KEY_PREVIOUS === process.env.KIOSK_MASTER_KEY) {
  errors.push('KIOSK_MASTER_KEY_PREVIOUS must differ from KIOSK_MASTER_KEY');
}

for (const warning of warnings) console.warn(`env warning: ${warning}`);
for (const error of errors) console.error(`env error: ${error}`);

if (errors.length > 0) process.exit(1);
console.log(`Environment contract valid (${strict ? 'strict' : 'local'} mode).`);
