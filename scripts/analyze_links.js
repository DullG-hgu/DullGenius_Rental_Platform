
const fs = require('fs');
const path = require('path');

const dataPath = path.resolve(__dirname, 'temp_youtube_links.json');
const games = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const urlGroups = {};

games.forEach(game => {
    let videoId = null;
    const url = game.video_url;

    if (!url) return;

    try {
        if (url.includes('youtube.com/watch')) {
            const urlObj = new URL(url);
            videoId = urlObj.searchParams.get('v');
        } else if (url.includes('youtu.be/')) {
            const parts = url.split('youtu.be/');
            if (parts.length > 1) {
                videoId = parts[1].split('?')[0];
            }
        }
    } catch (e) {
        // Invalid URL format
    }

    if (!videoId) {
        // Fallback for non-standard or just grouping by full URL if ID extraction fails
        videoId = url;
    }

    if (!urlGroups[videoId]) {
        urlGroups[videoId] = [];
    }
    urlGroups[videoId].push(game.name);
});

console.log(`Total Games: ${games.length}`);
console.log(`Unique Video IDs: ${Object.keys(urlGroups).length}`);

console.log('\n--- Duplicate Video IDs ---');
Object.entries(urlGroups).forEach(([videoId, names]) => {
    if (names.length > 1) {
        console.log(`Video ID: ${videoId}`);
        console.log(`Count: ${names.length}`);
        console.log(`Games: ${names.join(', ')}`);
        console.log('---');
    }
});
