const fs = require('fs');
const path = require('path');

const SEEDS_DIR = path.join(__dirname, '../db_seeds');
const TARGET_DIR = SEEDS_DIR; // Overwrite or new files in same dir

// Simple CSV Parser handling quotes
function parseCSV(text) {
    // Fix: Handle Windows CRLF properly
    const lines = text.trim().split(/\r?\n/);
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(line => {
        const values = parseLine(line);
        return headers.reduce((obj, header, index) => {
            // Fix: Trim map keys to remove potential BOM or whitespace
            const key = header ? header.trim() : `col_${index}`;
            obj[key] = values[index];
            return obj;
        }, {});
    });
    return rows;
}

function parseLine(line) {
    const values = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    // Trim the last value if needed, but not strictly required if split logic is correct.
    // Actually line split removes \r, so current should be clean.
    values.push(current);
    return values;
}

function toCSV(headers, rows) {
    const headerLine = headers.join(',');
    const encodedRows = rows.map(row => {
        return headers.map(h => {
            let val = row[h] === undefined || row[h] === null ? '' : String(row[h]);
            if (val.includes(',') || val.includes('\n') || val.includes('"')) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(',');
    });
    return [headerLine, ...encodedRows].join('\n');
}

// Main logic
try {
    console.log("Reading raw_games.csv...");
    const rawGamesPath = path.join(SEEDS_DIR, 'raw_games.csv');
    if (!fs.existsSync(rawGamesPath)) {
        throw new Error("raw_games.csv not found");
    }
    const rawGames = parseCSV(fs.readFileSync(rawGamesPath, 'utf8'));

    // 1. Split Games & Copies
    const gameHeaders = [
        'id', 'name', 'category', 'image', 'video_url', 'manual_url',
        'difficulty', 'genre', 'min_players', 'max_players', 'tags',
        'total_views', 'dibs_count', 'review_count', 'avg_rating',
        'naver_id', 'bgg_id'
    ];

    const copyHeaders = ['copy_id', 'game_id', 'status', 'location', 'condition', 'memo'];

    const games = [];
    const copies = [];

    rawGames.forEach((row, index) => {
        // Game
        games.push({
            id: row.id,
            name: row.name,
            category: row.category,
            image: row.image,
            video_url: '',
            manual_url: '',
            difficulty: row.difficulty,
            genre: row.genre,
            min_players: row.min_players,
            max_players: row.max_players,
            tags: row.tags,
            total_views: row.total_views,
            dibs_count: row.dibs_count,
            review_count: row.review_count,
            avg_rating: row.avg_rating,
            naver_id: row.naver_id,
            bgg_id: row.bgg_id
        });

        const copyId = row.id;
        copies.push({
            copy_id: copyId,
            game_id: row.id,
            status: row.status,
            location: '동아리방',
            condition: row.condition || 'A',
            memo: ''
        });
    });

    console.log(`Generated ${games.length} games and ${copies.length} copies.`);
    fs.writeFileSync(path.join(TARGET_DIR, 'games.csv'), toCSV(gameHeaders, games));
    fs.writeFileSync(path.join(TARGET_DIR, 'game_copies.csv'), toCSV(copyHeaders, copies));


    // 2. Update Rentals
    console.log("Reading rentals.csv...");
    const rawRentals = parseCSV(fs.readFileSync(path.join(SEEDS_DIR, 'rentals.csv'), 'utf8'));

    const rentalHeaders = [
        'rental_id', 'user_id', 'copy_id', 'game_name', 'renter_name',
        'borrowed_at', 'due_date', 'returned_at', 'type'
    ];

    const rentals = rawRentals.map((row, idx) => {
        const status = row.status ? row.status.trim() : '';
        // If status is 'RETURNED', populate returned_at.
        // Since we don't have exact time, we use current time for migration purposes, 
        // or maybe leave it empty but set status? 
        // The target table relies on returned_at IS NOT NULL for 'returned' status.
        const isReturned = status === 'RETURNED';

        const game = games.find(g => g.id === row.game_id);
        const gameName = game ? game.name : 'Unknown';

        return {
            rental_id: idx + 1,
            user_id: '', // Leave empty for now, or match if UUID
            copy_id: row.game_id,
            game_name: gameName,
            renter_name: row.user_id, // Move original user_id (name/id) to renter_name
            borrowed_at: row.borrowed_at,
            due_date: '',
            returned_at: isReturned ? (row.returned_at || new Date().toISOString()) : '',
            type: 'RENT'
        };
    });

    fs.writeFileSync(path.join(TARGET_DIR, 'rentals_updated.csv'), toCSV(rentalHeaders, rentals));


    // 3. Update Reviews
    console.log("Reading reviews.csv...");
    const rawReviews = parseCSV(fs.readFileSync(path.join(SEEDS_DIR, 'reviews.csv'), 'utf8'));
    const reviewHeaders = ['review_id', 'game_id', 'user_id', 'author_name', 'rating', 'content', 'created_at'];

    const reviews = rawReviews.map((row, idx) => {
        return {
            review_id: idx + 1,
            game_id: row.game_id,
            user_id: '',
            author_name: row.author_name,
            rating: row.rating,
            content: row.content,
            created_at: row.created_at
        };
    });

    fs.writeFileSync(path.join(TARGET_DIR, 'reviews_updated.csv'), toCSV(reviewHeaders, reviews));

    console.log("CSV Migration Complete.");

} catch (e) {
    console.error("Error:", e);
}
