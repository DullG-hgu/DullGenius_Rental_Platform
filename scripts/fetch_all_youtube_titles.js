
const fs = require('fs');
const path = require('path');
const https = require('https');

const dataPath = path.resolve(__dirname, 'temp_youtube_links.json');
const games = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Extract unique video IDs
const uniqueVideoIds = new Set();
const videoIdMap = {}; // ID -> original URL

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
    } catch (e) { }

    if (videoId) {
        uniqueVideoIds.add(videoId);
        videoIdMap[videoId] = url;
    }
});

console.log(`Found ${uniqueVideoIds.size} unique video IDs.`);

const results = {};
const videoIds = Array.from(uniqueVideoIds);

function fetchTitle(videoId) {
    return new Promise((resolve) => {
        const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        resolve({ videoId, error: json.error });
                    } else {
                        resolve({ videoId, title: json.title, author: json.author_name });
                    }
                } catch (e) {
                    resolve({ videoId, error: 'JSON parse error' });
                }
            });
        }).on('error', (err) => {
            resolve({ videoId, error: err.message });
        });
    });
}

async function processBatch() {
    const BATCH_SIZE = 5;
    for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
        const batch = videoIds.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${i / BATCH_SIZE + 1}...`);
        const promises = batch.map(id => fetchTitle(id));
        const batchResults = await Promise.all(promises);

        batchResults.forEach(res => {
            results[res.videoId] = res;
        });

        // rudimentary rate limiting
        await new Promise(r => setTimeout(r, 500));
    }

    // Generate Report Data
    const report = [];
    games.forEach(game => {
        let videoId = null;
        const url = game.video_url;
        try {
            if (url && url.includes('youtube.com/watch')) {
                videoId = new URL(url).searchParams.get('v');
            } else if (url && url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1].split('?')[0];
            }
        } catch (e) { }

        if (videoId && results[videoId]) {
            const info = results[videoId];
            report.push({
                gameId: game.id,
                gameName: game.name,
                videoId: videoId,
                videoTitle: info.title,
                videoAuthor: info.author,
                error: info.error
            });
        }
    });

    const outputPath = path.resolve(__dirname, 'youtube_titles_report.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Report saved to ${outputPath}`);
}

processBatch();
