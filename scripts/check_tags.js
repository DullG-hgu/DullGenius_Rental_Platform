
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase URL or publishable key');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTags() {
    const { data: games, error } = await supabase
        .from('games')
        .select('id, name, tags')
        .limit(10);

    if (error) {
        console.error('Error fetching games:', error);
        return;
    }

    console.log('--- Game Tags Inspection ---');
    games.forEach(game => {
        console.log(`[${game.name}]:`, JSON.stringify(game.tags), `(Type: ${typeof game.tags})`);
    });
}

checkTags();
