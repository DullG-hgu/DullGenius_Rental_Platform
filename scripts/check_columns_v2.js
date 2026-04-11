const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) env[key.trim()] = val.trim();
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkSchema() {
    console.log("🔍 Checking 'game_copies' for 'condition' column...");

    // Check 1: Try selecting just copy_id and condition
    const { data: conditionData, error: conditionError } = await supabase
        .from('game_copies')
        .select('copy_id, condition')
        .limit(1);

    if (conditionError) {
        console.log("❌ 'condition' column check failed:");
        console.log(conditionError.message);
    } else {
        console.log("✅ 'condition' column EXISTS.");
    }

    // Check 2: Try selecting just copy_id and memo
    const { data: memoData, error: memoError } = await supabase
        .from('game_copies')
        .select('copy_id, memo')
        .limit(1);

    if (memoError) {
        console.log("❌ 'memo' column check failed:");
        console.log(memoError.message);
    } else {
        console.log("✅ 'memo' column EXISTS.");
    }
}

checkSchema();
