
const https = require('https');

const urls = [
    "https://www.youtube.com/watch?v=yO-uzwN6oaI", // Suspicious duplicate
    "https://www.youtube.com/watch?v=mVK7YZLPvx4", // Suspicious duplicate
    "https://youtu.be/JAWrvTEPDLc", // 1% miracle
    "https://www.youtube.com/watch?v=nonexistentvideo123" // Invalid
];

urls.forEach(url => {
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            const titleMatch = data.match(/<meta property="og:title" content="([^"]+)">/);
            const title = titleMatch ? titleMatch[1] : 'No og:title found';
            const unavailable = data.includes("Video unavailable");
            console.log(`URL: ${url}`);
            console.log(`Title: ${title}`);
            console.log(`Unavailable: ${unavailable}`);
            console.log('---');
        });
    }).on('error', (err) => {
        console.error(`Error fetching ${url}: ${err.message}`);
    });
});
