
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function searchTags(keyword) {
    console.log(`Searching for games with tag containing: "${keyword}"`);

    // Fetch all games with non-null tags
    const { data: games, error } = await supabase
        .from('games')
        .select('id, name, tags')
        .not('tags', 'is', null);

    if (error) {
        console.error('Error fetching games:', error);
        return;
    }

    const matches = games.filter(g => {
        if (typeof g.tags === 'string') {
            return g.tags.includes(keyword);
        }
        return false;
    });

    console.log(`Found ${matches.length} matching games:`);
    matches.forEach(g => {
        console.log(`- ${g.name}: ${g.tags}`);
    });
}

searchTags('전략');
