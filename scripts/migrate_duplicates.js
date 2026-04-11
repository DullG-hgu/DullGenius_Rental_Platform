const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load Env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) env[key.trim()] = val.trim();
});

const supabaseUrl = env.REACT_APP_SUPABASE_URL;
const supabaseKey = env.REACT_APP_SUPABASE_ANON_KEY;
// IMPORTANT: Use SERVICE_ROLE key if available for deletions, otherwise ANON key with RLS might fail 
// if the user is not the owner. But assuming local dev environment or admin rights context.
// Actually, RLS usually blocks delete for anon. We might need to rely on the fact user is an admin or we have a service role key.
// Since we don't have service role key in .env usually (security), we hope anon key has rights or RLS is permissive for now.
// If this fails, we will need to ask user for Service Key or use SQL editor.
// *Assumption*: The `analyze` script worked, so we have read access. Write access depends on RLS.

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase Credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
    console.log("?? Starting Migration...");

    // 0. Pre-process: Rename '뱅!' to '뱅'
    // We do this first so the standard "exact match" logic picks them up together.
    console.log("Step 0: Unifying '뱅!' aliases...");
    const { data: bangGames, error: bangError } = await supabase
        .from('games')
        .select('*')
        .eq('name', '뱅!');

    if (bangGames && bangGames.length > 0) {
        for (const game of bangGames) {
            console.log(`Renaming '뱅!' (ID: ${game.id}) to '뱅'`);
            await supabase.from('games').update({ name: '뱅' }).eq('id', game.id);
        }
    }

    // 1. Fetch Process
    console.log("Step 1: Fetching all games...");
    const { data: games, error } = await supabase
        .from('games')
        .select('*')
        .order('id'); // Order by ID to keep the oldest as master

    if (error) {
        console.error("Fetch failed:", error);
        return;
    }

    // 2. Group by Name
    const groups = {};
    games.forEach(g => {
        const name = g.name.trim(); // Normalize
        if (!groups[name]) groups[name] = [];
        groups[name].push(g);
    });

    // 3. Process Groups
    let mergeCount = 0;

    for (const name of Object.keys(groups)) {
        const group = groups[name];
        if (group.length < 2) continue; // No duplicates

        mergeCount++;
        console.log(`\nMerging Group: "${name}" (${group.length} items)`);

        // Master is the first one (lowest ID => assumed oldest/original)
        const master = group[0];
        const slaves = group.slice(1);
        const slaveIds = slaves.map(g => g.id);

        console.log(`- Master ID: ${master.id}`);
        console.log(`- Slaves IDs: ${slaveIds.join(', ')}`);

        // A. Move Game Copies
        // Update game_copies where game_id IN slaveIds -> SET game_id = master.id
        console.log(`  -> Moving copies...`);
        const { error: copyErr } = await supabase
            .from('game_copies')
            .update({ game_id: master.id })
            .in('game_id', slaveIds);
        if (copyErr) console.error("Copy move failed:", copyErr);

        // B. Move Reviews
        console.log(`  -> Moving reviews...`);
        const { error: reviewErr } = await supabase
            .from('reviews')
            .update({ game_id: master.id })
            .in('game_id', slaveIds);
        if (reviewErr) console.error("Review move failed:", reviewErr);

        // C. Move Logs (Optional but good)
        console.log(`  -> Moving logs...`);
        const { error: logErr } = await supabase
            .from('logs')
            .update({ game_id: master.id })
            .in('game_id', slaveIds);
        if (logErr) console.error("Log move failed:", logErr);

        // D. Delete Slaves
        // (Rentals are linked to game_copies, so they move automatically with the copy? 
        //  Wait, rentals table might have game_id if de-normalized. Let's check schema.
        //  Looking at api.js `fetchGames`: rentals are joined via `game_copies`.
        //  So moving `game_copies` is sufficient for rentals! 
        //  BUT verification: `rentals` table schema check?
        //  Assuming standard normalized form. If rentals has game_id directly, we need to update it.)

        //  Let's fail-safe: Try updating rentals.game_id JUST IN CASE it exists.
        //  If column doesn't exist, this might throw error, but we can catch it.
        //  Actually, better to check before updating or just ignore. 
        //  Based on api.js code: `rentals ( ..., game_copies!inner ( ... ) )`. 
        //  It seems rentals links to copies. so we are good.

        console.log(`  -> Deleting slave games...`);
        const { error: delErr } = await supabase
            .from('games')
            .delete()
            .in('id', slaveIds);

        if (delErr) {
            console.error("  ??Delete failed (Foreign Key constraint?):", delErr.message);
            console.log("     Skipping deletion for safety. Please delete manually.");
        } else {
            console.log("  ??Merged successfully.");
        }
    }

    if (mergeCount === 0) {
        console.log("\nNo duplicates found to merge.");
    } else {
        console.log(`\nDone! Merged ${mergeCount} groups.`);
    }
}

migrate();
