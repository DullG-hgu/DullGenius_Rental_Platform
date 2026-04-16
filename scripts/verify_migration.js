const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) env[key.trim()] = val.trim();
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    console.log("🔍 Verifying Migration Results...");

    const targets = ['뱅']; // Other corrupted targets removed

    for (const name of targets) {
        const { data: games } = await supabase
            .from('games')
            .select('id, name, game_copies(count)')
            .eq('name', name);

        console.log(`\nChecking "${name}":`);
        if (!games || games.length === 0) {
            console.log("❌ Not Found!");
            continue;
        }

        if (games.length > 1) {
            console.log(`❌ Still Duplicated! Found ${games.length} entries.`);
            games.forEach(g => console.log(` - ID: ${g.id}`));
        } else {
            const game = games[0];
            const copyCount = game.game_copies[0]?.count || 0;
            console.log(`✅ Unique Entry (ID: ${game.id})`);
            console.log(`   Copy Count: ${copyCount}`);

            if (copyCount >= 2) {
                console.log("   --> SUCCESS: Has multiple copies.");
            } else {
                console.log("   --> WARNING: Has only 1 copy (maybe only 1 existed before?)");
            }
        }
    }
}

verify();
