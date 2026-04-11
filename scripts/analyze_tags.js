
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeTags() {
    // Fetch all games
    const { data: games, error } = await supabase
        .from('games')
        .select('id, name, tags');

    if (error) {
        console.error('Error fetching games:', error);
        return;
    }

    let totalGames = games.length;
    let nullTags = 0;
    let stringTags = 0;
    let arrayTags = 0;
    let otherTags = 0;
    let tagsWithoutHash = [];
    let uniqueTags = new Set();

    games.forEach(game => {
        if (game.tags === null || game.tags === undefined) {
            nullTags++;
        } else if (typeof game.tags === 'string') {
            stringTags++;
            // Check content
            const parts = game.tags.split(/\s+/).filter(Boolean);
            parts.forEach(p => {
                uniqueTags.add(p);
                if (!p.startsWith('#')) {
                    tagsWithoutHash.push({ name: game.name, tag: p });
                }
            });
        } else if (Array.isArray(game.tags)) {
            arrayTags++;
        } else {
            otherTags++;
        }
    });

    console.log('--- Tag Analysis ---');
    console.log(`Total Games: ${totalGames}`);
    console.log(`Null Tags: ${nullTags}`);
    console.log(`String Tags: ${stringTags}`);
    console.log(`Array Tags: ${arrayTags}`);
    console.log(`Other Tags: ${otherTags}`);

    if (tagsWithoutHash.length > 0) {
        console.log('\nTags without #:');
        tagsWithoutHash.slice(0, 10).forEach(item => console.log(`- ${item.name}: ${item.tag}`));
        if (tagsWithoutHash.length > 10) console.log(`... and ${tagsWithoutHash.length - 10} more`);
    } else {
        console.log('\nAll individual tags start with #');
    }

    console.log(`\nTotal Unique Tags: ${uniqueTags.size}`);
}

analyzeTags();
