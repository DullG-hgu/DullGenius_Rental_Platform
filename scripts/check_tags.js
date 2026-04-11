
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
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
