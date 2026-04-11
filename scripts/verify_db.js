const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load Environment Variables (Robustly)
const envPath = path.resolve(__dirname, '../.env');
let env = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length > 0) {
            env[key.trim()] = vals.join('=').trim();
        }
    });
}

const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Supabase URL/Key Missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyDB() {
    console.log("🔍 Verifying DB Data...");

    // Fetch first 10 games
    const { data: games, error } = await supabase
        .from('games')
        .select('id, name, quantity, available_count')
        .limit(20);

    if (error) {
        console.error("Error fetching games:", error);
        return;
    }

    console.log("--- DB Snapshot ---");
    games.forEach(g => {
        console.log(`[${g.name}] Qty: ${g.quantity}, Avail: ${g.available_count}`);
    });
    console.log("-------------------");
}

verifyDB();
