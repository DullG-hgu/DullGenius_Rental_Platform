
const https = require('https');

const videoIds = ['yO-uzwN6oaI', 'mVK7YZLPvx4', 'JAWrvTEPDLc'];

videoIds.forEach(id => {
    const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`;
    https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                console.log(`ID: ${id}`);
                console.log(`Title: ${json.title}`);
                console.log(`Author: ${json.author_name}`);
                console.log('---');
            } catch (e) {
                console.error(`Error parsing ${id}: ${e.message}`);
            }
        });
    });
});
