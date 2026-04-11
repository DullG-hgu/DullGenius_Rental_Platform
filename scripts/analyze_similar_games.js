const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load Env
const envPath = path.resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) env[key.trim()] = val.trim();
});

const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase Credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Levenshtein Distance Function
const levenshtein = (a, b) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

async function run() {
    console.log("Fetching games...");
    const { data: games, error } = await supabase
        .from('games')
        .select('id, name')
        .order('name');

    if (error) {
        console.error("Error fetching games:", error);
        return;
    }

    console.log(`Total games found: ${games.length}`);

    // 1. Check Exact Duplicates
    const nameMap = {};
    const exactDuplicates = [];

    games.forEach(g => {
        const normName = g.name.trim(); // Case sensitive exact match for now, or maybe insensitive?
        if (!nameMap[normName]) nameMap[normName] = [];
        nameMap[normName].push(g);
    });

    Object.keys(nameMap).forEach(name => {
        if (nameMap[name].length > 1) {
            exactDuplicates.push({
                name: name,
                ids: nameMap[name].map(x => x.id)
            });
        }
    });

    console.log("\n[Exact Duplicates] (Safe to Merge?)");
    if (exactDuplicates.length === 0) console.log("None");
    exactDuplicates.forEach(d => {
        console.log(`- "${d.name}": IDs [${d.ids.join(', ')}]`);
    });

    // 2. Check Similar Names (Potential False Positives)
    const similarPairs = [];
    const names = games.map(g => g.name);

    for (let i = 0; i < games.length; i++) {
        for (let j = i + 1; j < games.length; j++) {
            const A = games[i];
            const B = games[j];

            if (A.name === B.name) continue; // Already covered by exact dupes

            // Criteria 1: Substring (e.g. "Bang" in "Bang!")
            // Criteria 2: Levenshtein distance <= 2 (for short strings might be bad, check length)

            const isSubstring = A.name.includes(B.name) || B.name.includes(A.name);
            const dist = levenshtein(A.name, B.name);
            const isClose = dist <= 2 && Math.min(A.name.length, B.name.length) > 3;

            if (isSubstring || isClose) {
                similarPairs.push({
                    a: A.name,
                    b: B.name,
                    reason: isSubstring ? "Substring" : `Edit Dist ${dist}`
                });
            }
        }
    }

    console.log("\n[Similar Names] (Check these carefully!)");
    if (similarPairs.length === 0) console.log("None");
    similarPairs.forEach(p => {
        console.log(`- "${p.a}" vs "${p.b}" (${p.reason})`);
    });
}

run();
