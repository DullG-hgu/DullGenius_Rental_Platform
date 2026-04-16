
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load environment variables from .env manually
const envPath = path.resolve(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
    console.error('.env.local file not found at:', envPath);
    process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
console.log('Parsing .env.local file...');
envContent.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;

    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        let value = parts.slice(1).join('=').trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        envVars[key] = value;
        // console.log(`Loaded key: ${key}`); // Masking value
    }
});

const supabaseUrl = envVars['VITE_SUPABASE_URL'];
const supabaseKey = envVars['VITE_SUPABASE_ANON_KEY'];

console.log(`Supabase URL found: ${!!supabaseUrl}`);
console.log(`Supabase Key found: ${!!supabaseKey}`);

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fetchYoutubeLinks() {
    console.log('Fetching games with YouTube links...');

    // Fetch games where video_url is not null and not empty string
    const { data: games, error } = await supabase
        .from('games')
        .select('id, name, video_url')
        .not('video_url', 'is', null)
        .neq('video_url', '');

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    console.log(`Found ${games.length} games with video URLs.`);

    const outputPath = path.resolve(__dirname, 'temp_youtube_links.json');
    fs.writeFileSync(outputPath, JSON.stringify(games, null, 2), 'utf8');

    console.log(`Data saved to ${outputPath}`);
}

fetchYoutubeLinks();
