// @vitest-environment node
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, expect, it } from 'vitest';

// 빈 작업 폴더 + 명시적 가짜 환경: 실제 .env 및 운영 자격증명을 읽지 않는다.
const cwd = mkdtempSync(join(tmpdir(), 'rental-env-test-'));
afterAll(() => rmdirSync(cwd));
const script = fileURLToPath(new URL('../scripts/validate_env.mjs', import.meta.url));
const client = { VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const kiosk = { SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', KIOSK_EMAIL: 'test@example.invalid', KIOSK_PASSWORD: 'fake-password', KIOSK_MASTER_KEY: 'test-only-key-with-at-least-32-characters' };
function check(args = [], env = {}) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
}

it.each([{}, { NETLIFY: 'true' }])('build scope works without server credentials (%j)', environment => {
    const result = check(['--scope=client'], { ...client, ...environment });
    expect(result.status).toBe(0);
    expect(result.output).not.toContain('warning:');
    expect(result.output).toContain('client scope');
});
it('client scope ignores a short server key but still requires client settings', () => {
    expect(check([], { ...client, KIOSK_MASTER_KEY: 'short' }).output).not.toContain('warning:');
    expect(check([], {}).status).toBe(1);
});
it('kiosk scope accepts server-only credentials without NAVER or BGG', () => {
    expect(check(['--scope=kiosk', '--strict'], kiosk).status).toBe(0);
});
it.each(['KIOSK_EMAIL', 'KIOSK_PASSWORD', 'KIOSK_MASTER_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'])('kiosk scope rejects missing %s', key => {
    const env = { ...kiosk };
    delete env[key];
    expect(check(['--scope=kiosk'], env).status).toBe(1);
});
it('kiosk scope never substitutes the frontend key for the server key', () => {
    expect(check(['--scope=kiosk'], { ...kiosk, SUPABASE_PUBLISHABLE_KEY: '', ...client }).status).toBe(1);
});
it.each(['client', 'kiosk', 'all'])('rejects invalid key formats even outside strict mode in %s scope', scope => {
    for (const value of ['', 'eyJ_invalid_legacy_fixture', 'sb_secret_test', 'invalid', 'sb_publishable_']) {
        const result = check([`--scope=${scope}`], {
            ...client, ...kiosk,
            VITE_SUPABASE_PUBLISHABLE_KEY: value, SUPABASE_PUBLISHABLE_KEY: value,
        });
        expect(result.status).toBe(1);
        if (value && value !== 'sb_publishable_') expect(result.output).not.toContain(value);
    }
});
it('rejects obsolete settings even alongside a valid new key', () => {
    for (const prefix of ['', 'VITE_', 'REACT_APP_']) {
        const name = prefix + ['SUPABASE', 'ANON', 'KEY'].join('_');
        const result = check([], { ...client, [name]: 'never-print-obsolete-value' });
        expect(result.status).toBe(1);
        expect(result.output).not.toContain('never-print-obsolete-value');
    }
});
it('all scope independently validates both frontend and server public keys', () => {
    const env = { ...client, ...kiosk, NAVER_API_HUB_CLIENT_ID: 'test', NAVER_API_HUB_CLIENT_SECRET: 'test', BGG_API_TOKEN: 'test' };
    expect(check(['--scope=all'], { ...env, SUPABASE_PUBLISHABLE_KEY: '' }).status).toBe(1);
    expect(check(['--scope=all'], { ...env, VITE_SUPABASE_PUBLISHABLE_KEY: '' }).status).toBe(1);
});
it('rejects a legacy administrator key without printing it', () => {
    const result = check([], { ...client, SUPABASE_SERVICE_ROLE_KEY: 'eyJ_private_fixture' });
    expect(result.status).toBe(1);
    expect(result.output).not.toContain('eyJ_private_fixture');
});
it('all scope requires external API settings too', () => {
    expect(check(['--scope=all'], { ...client, ...kiosk }).status).toBe(1);
    expect(check(['--scope=all'], { ...client, ...kiosk, NAVER_API_HUB_CLIENT_ID: 'test', NAVER_API_HUB_CLIENT_SECRET: 'test', BGG_API_TOKEN: 'test' }).status).toBe(0);
});
it.each(['client', 'kiosk', 'all'])('blocks public secrets without printing values in %s scope', scope => {
    const result = check([`--scope=${scope}`], { ...client, ...kiosk, VITE_KIOSK_PASSWORD: 'never-print-this-test-value' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('VITE_KIOSK_PASSWORD must use a server-only variable name');
    expect(result.output).not.toContain('never-print-this-test-value');
});
it('keeps short-key warnings and rejects identical rotation keys in kiosk scope', () => {
    const short = check(['--scope=kiosk'], { ...kiosk, KIOSK_MASTER_KEY: 'short' });
    expect(short.status).toBe(0);
    expect(short.output).toContain('should be at least 32 characters');
    expect(check(['--scope=kiosk'], { ...kiosk, KIOSK_MASTER_KEY_PREVIOUS: kiosk.KIOSK_MASTER_KEY }).status).toBe(1);
});
it('rejects an invalid scope', () => {
    expect(check(['--scope=unknown'], client).status).toBe(1);
});
