// @vitest-environment node
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const keepalive = require('../netlify/functions/supabase-keepalive.js').handler;
const kiosk = require('../netlify/functions/kiosk-session.js').handler;
const naver = require('../netlify/functions/naver-image-proxy.js').handler;
const oldName = ['SUPABASE', 'ANON', 'KEY'].join('_');
const legacyValue = 'eyJ_rejected_fixture';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('server public key contract', () => {
    const events = {
        keepalive: {},
        kiosk: { httpMethod: 'POST', headers: {}, body: JSON.stringify({ key: 'device-test-only' }) },
        naver: { httpMethod: 'GET', headers: { authorization: 'Bearer test-session' }, queryStringParameters: { query: 'test' } },
    };
    it.each([['keepalive', keepalive], ['kiosk', kiosk], ['naver', naver]])('%s rejects old and missing keys without sending a request', async (name, handler) => {
        vi.useFakeTimers();
        vi.stubEnv('SUPABASE_URL', 'https://example.invalid');
        vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_frontend');
        vi.stubEnv(oldName, 'sb_publishable_old_name');
        vi.stubEnv('VITE_' + oldName, 'sb_publishable_old_name');
        vi.stubEnv('KIOSK_MASTER_KEY', 'device-test-only');
        vi.stubEnv('KIOSK_EMAIL', 'test@example.invalid');
        vi.stubEnv('KIOSK_PASSWORD', 'test-only');
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        for (const value of ['', legacyValue, 'sb_secret_server']) {
            vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', value);
            const pending = handler(events[name]);
            await vi.runAllTimersAsync();
            const response = await pending;
            expect(response.statusCode).toBe(500);
            if (value) expect(response.body).not.toContain(value);
        }
        expect(fetch).not.toHaveBeenCalled();
    });
    it('keepalive sends only the configured publishable key as apikey', async () => {
        vi.stubEnv('SUPABASE_URL', 'https://example.invalid');
        vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_server');
        const fetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetch);
        expect((await keepalive()).statusCode).toBe(200);
        expect(fetch).toHaveBeenCalledWith('https://example.invalid/rest/v1/games?select=id&limit=1', {
            headers: { apikey: 'sb_publishable_server' },
        });
    });
});

it('repository scan rejects hidden environment backups and untracked hardcoding without exposing values', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'supabase-key-scan-'));
    const script = fileURLToPath(new URL('../scripts/validate_supabase_refs.mjs', import.meta.url));
    try {
        execFileSync('git', ['init', '-q'], { cwd });
        writeFileSync(join(cwd, '.gitignore'), '.env*\n');
        const scan = () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
        expect(scan().status).toBe(0);
        writeFileSync(join(cwd, '.env.local.bak'), `${oldName}=private-test-value\n`);
        const rejectedEnv = scan();
        expect(rejectedEnv.status).toBe(1);
        expect(rejectedEnv.stderr).toContain('.env.local.bak');
        expect(rejectedEnv.stderr).not.toContain('private-test-value');
        writeFileSync(join(cwd, '.env.local.bak'), '');
        const jwt = ['eyJ0ZXN0', 'eyJmaXh0dXJl', 'signature'].join('.');
        writeFileSync(join(cwd, 'old-script.js'), `const key = '${jwt}';`);
        const rejectedJwt = scan();
        expect(rejectedJwt.status).toBe(1);
        expect(rejectedJwt.stderr).toContain('old-script.js');
        expect(rejectedJwt.stderr).not.toContain(jwt);
        writeFileSync(join(cwd, 'old-script.js'), 'const key = process.env.SUPABASE_PUBLISHABLE_KEY;');
        expect(scan().status).toBe(0);
    } finally {
        rmSync(cwd, { recursive: true });
    }
});
