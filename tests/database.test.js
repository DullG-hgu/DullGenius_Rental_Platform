// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../database/_LIVE/schema.sql', import.meta.url), 'utf8');
const functions = readFileSync(new URL('../database/_LIVE/functions.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../database/20260908_homepage_integrity.sql', import.meta.url), 'utf8');
const userId = '00000000-0000-0000-0000-000000000001';
const otherUserId = '00000000-0000-0000-0000-000000000002';
const kioskId = '00000000-0000-0000-0000-000000000003';
let db;

async function scalar(sql, params = []) {
    return Object.values((await db.query(sql, params)).rows[0])[0];
}
async function rental({ user = userId, due = "now() + interval '1 day'", borrowed = "now() - interval '1 day'", type = 'RENT' } = {}) {
    return scalar(`INSERT INTO rentals (game_id, user_id, due_date, borrowed_at, type)
        VALUES (1, $1, ${due}, ${borrowed}, $2) RETURNING rental_id`, [user, type]);
}
async function returnRental(id, user = otherUserId, game = 1) {
    return scalar('SELECT kiosk_return($1, $2, $3)', [game, user, id]);
}

describe('homepage database migration on isolated PostgreSQL (PGlite)', () => {
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
            $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
            CREATE SEQUENCE games_id_seq;
            CREATE TABLE user_roles (user_id uuid, role_key text);`);
        for (const name of ['games', 'rentals', 'profiles', 'point_transactions', 'matches', 'logs', 'game_daily_stats']) {
            await db.exec(schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
        }
        for (const name of ['is_kiosk_or_admin', 'count_active_occupancy', 'recalc_game_availability', 'earn_points', 'get_trending_games']) {
            const start = functions.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
            const body = functions.indexOf('AS $function$', start);
            const end = functions.indexOf('$function$', body + 13) + 10;
            await db.exec(functions.slice(start, end) + ';');
        }
        // A pre-existing anomaly must survive migration without invented dates.
        await db.exec(`INSERT INTO games(id, name) VALUES (1, 'fixture');
            INSERT INTO rentals(game_id, due_date, borrowed_at, returned_at)
            VALUES (1, now(), now(), now() - interval '1 hour');`);
        await db.exec(migration);
        expect(await scalar('SELECT count(*)::int FROM rentals WHERE returned_at < borrowed_at')).toBe(1);
        await db.exec(migration); // Replaying this migration must not duplicate triggers.
    }, 30000);

    beforeEach(async () => {
        await db.exec(`RESET ROLE;
            TRUNCATE rentals, games, profiles, user_roles, point_transactions, logs, matches, game_daily_stats;
            INSERT INTO games(id, name, quantity, available_count) VALUES (1, 'fixture', 10, 9), (2, 'other', 1, 1);
            INSERT INTO profiles(id, student_id, name) VALUES ('${userId}', 'fixture1', 'fixture'), ('${otherUserId}', 'fixture2', 'other');
            INSERT INTO user_roles VALUES ('${kioskId}', 'kiosk');
            SET request.jwt.claim.sub = '${kioskId}';`);
    });
    afterAll(async () => { await db?.close(); });

    it('awards the locked rental owner and records exact rental ID, ignoring forged recipient', async () => {
        const id = await rental();
        expect(await returnRental(id)).toEqual({ success: true, points_awarded: 50 });
        expect(await scalar('SELECT current_points FROM profiles WHERE id=$1', [userId])).toBe(50);
        expect(await scalar('SELECT current_points FROM profiles WHERE id=$1', [otherUserId])).toBe(0);
        expect(await scalar("SELECT details->>'rental_id' FROM logs")).toBe(id);
        expect(await scalar('SELECT user_id FROM logs')).toBe(userId);
        expect(await scalar('SELECT available_count FROM games WHERE id=1')).toBe(10);
    });

    it('returns overdue and guest rentals without awarding points', async () => {
        expect(await returnRental(await rental({ due: "now() - interval '1 second'" }))).toEqual({ success: true, points_awarded: 0 });
        expect(await returnRental(await rental({ user: null }))).toEqual({ success: true, points_awarded: 0 });
        expect(await scalar('SELECT count(*)::int FROM point_transactions')).toBe(0);
        expect(await scalar('SELECT count(*)::int FROM rentals WHERE returned_at IS NOT NULL')).toBe(2);
    });

    it('retries cannot award twice or return another rental', async () => {
        const first = await rental();
        const second = await rental();
        await returnRental(first);
        expect((await returnRental(first)).success).toBe(false);
        expect((await returnRental(null, userId)).success).toBe(false);
        expect(await scalar('SELECT returned_at FROM rentals WHERE rental_id=$1', [second])).toBeNull();
        expect(await scalar('SELECT count(*)::int FROM point_transactions')).toBe(1);
        expect(await scalar('SELECT count(*)::int FROM logs')).toBe(1);
        expect(await scalar('SELECT available_count FROM games WHERE id=1')).toBe(9);
    });

    it('rejects members, wrong game IDs, and DIBS without mutation', async () => {
        const id = await rental();
        await db.exec(`SET request.jwt.claim.sub = '${userId}'; SET ROLE authenticated;`);
        expect((await returnRental(id)).success).toBe(false);
        await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${kioskId}';`);
        expect((await returnRental(id, userId, 2)).success).toBe(false);
        expect((await returnRental(await rental({ type: 'DIBS' }))).success).toBe(false);
        expect(await scalar('SELECT count(*)::int FROM rentals WHERE returned_at IS NOT NULL')).toBe(0);
        expect(await scalar('SELECT count(*)::int FROM logs')).toBe(0);
    });

    it('rejects future/missing borrowing times with no partial return', async () => {
        for (const borrowed of ["now() + interval '1 hour'", 'NULL']) {
            const id = await rental({ borrowed });
            expect((await returnRental(id)).success).toBe(false);
            expect(await scalar('SELECT returned_at FROM rentals WHERE rental_id=$1', [id])).toBeNull();
        }
        expect(await scalar('SELECT count(*)::int FROM point_transactions')).toBe(0);
    });

    it('allows anonymous aggregate ranking but denies anonymous returns and table writes', async () => {
        await db.exec("INSERT INTO game_daily_stats(id, game_id, date, view_count) VALUES (1, 1, current_date, 5); SET ROLE anon;");
        expect((await db.query('SELECT * FROM get_trending_games()')).rows).toEqual([
            { id: 1, name: 'fixture', image: null, category: null, weekly_views: 5 },
        ]);
        await expect(returnRental(null)).rejects.toThrow(/permission denied/);
        await expect(db.exec("INSERT INTO games(name) VALUES ('forbidden')")).rejects.toThrow(/permission denied/);
    });

    it('stores the current instant under both UTC and Asia/Seoul sessions', async () => {
        for (const zone of ['UTC', 'Asia/Seoul']) {
            await db.exec(`SET timezone = '${zone}'; BEGIN;`);
            expect(await scalar(`INSERT INTO point_transactions(user_id, amount) VALUES ('${userId}', 1)
                RETURNING created_at = now()`)).toBe(true);
            expect(await scalar("INSERT INTO matches(players) VALUES ('[]') RETURNING played_at = now()")).toBe(true);
            await db.exec('COMMIT;');
        }
    });

    it('guards new RENT time reversals but allows cancelled future HOLD rows', async () => {
        expect(await scalar("SELECT count(*)::int FROM pg_trigger WHERE tgname='guard_rental_return_chronology'")).toBe(1);
        const id = await rental();
        await expect(db.query("UPDATE rentals SET returned_at=borrowed_at - interval '1 second' WHERE rental_id=$1", [id]))
            .rejects.toMatchObject({ code: '23514', constraint: 'rental_return_chronology' });
        const hold = await rental({ type: 'HOLD', borrowed: "now() + interval '1 day'" });
        await db.query('UPDATE rentals SET returned_at=now() WHERE rental_id=$1', [hold]);
        await expect(db.query("UPDATE rentals SET type='RENT' WHERE rental_id=$1", [hold]))
            .rejects.toMatchObject({ code: '23514' });
    });

    it('permits anonymization and evidence-based correction of pre-migration anomalies', async () => {
        // Simulate historical data only in this isolated fixture database.
        await db.exec('ALTER TABLE rentals DISABLE TRIGGER guard_rental_return_chronology');
        const id = await rental();
        await db.query("UPDATE rentals SET returned_at=borrowed_at - interval '1 hour' WHERE rental_id=$1", [id]);
        await db.exec('ALTER TABLE rentals ENABLE TRIGGER guard_rental_return_chronology');
        await db.query('UPDATE rentals SET user_id=NULL, renter_name=$1 WHERE rental_id=$2', ['탈퇴 회원', id]);
        // Full-row updates may list time columns without actually changing them.
        await db.query('UPDATE rentals SET returned_at=returned_at, borrowed_at=borrowed_at WHERE rental_id=$1', [id]);
        expect(await scalar('SELECT returned_at < borrowed_at AND user_id IS NULL FROM rentals WHERE rental_id=$1', [id])).toBe(true);
        await expect(db.query("UPDATE rentals SET returned_at=borrowed_at - interval '2 hours' WHERE rental_id=$1", [id]))
            .rejects.toMatchObject({ code: '23514' });
        await db.query("UPDATE rentals SET returned_at=borrowed_at + interval '1 hour' WHERE rental_id=$1", [id]);
        expect(await scalar('SELECT returned_at >= borrowed_at FROM rentals WHERE rental_id=$1', [id])).toBe(true);
    });

    it('requires borrowing time for closed RENT inserts, while open RENT can omit it', async () => {
        await expect(db.exec(`INSERT INTO rentals(game_id, due_date, borrowed_at, returned_at, type)
            VALUES (1, now(), NULL, now(), 'RENT')`)).rejects.toMatchObject({ code: '23514' });
        await expect(db.exec(`INSERT INTO rentals(game_id, due_date, borrowed_at, returned_at, type)
            VALUES (1, now(), now(), now() - interval '1 hour', 'RENT')`)).rejects.toMatchObject({ code: '23514' });
        const id = await rental({ borrowed: 'NULL' });
        expect(await scalar('SELECT returned_at FROM rentals WHERE rental_id=$1', [id])).toBeNull();
    });
});
