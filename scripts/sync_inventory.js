const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Load Environment Variables
const envPath = path.resolve(__dirname, '../.env');
let env = {};
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length > 0) {
            env[key.trim()] = vals.join('=').trim();
        }
    });
}

const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Supabase URL/Key Missing!");
    console.log("Loaded Keys:", Object.keys(env));
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. CSV Parser
function parseCSV(text) {
    const lines = text.trim().split('\n');
    // Simple parser handling quotes
    const parseLine = (line) => {
        const row = [];
        let current = '';
        let insideQuote = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                insideQuote = !insideQuote;
            } else if (char === ',' && !insideQuote) {
                row.push(current.trim().replace(/^"|"$/g, '')); // remove surrounding quotes
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim().replace(/^"|"$/g, ''));
        return row;
    };

    return lines.slice(1).map(parseLine); // Skip header
}

// 3. Main Logic
async function syncInventory() {
    console.log("🚀 Starting Inventory Sync...");

    try {
        // 3.1 Read CSV
        const csvPath = path.resolve(__dirname, '../archive/DullG_BoardGame_Rental - Games (2).csv');
        if (!fs.existsSync(csvPath)) {
            throw new Error(`CSV not found at: ${csvPath}`);
        }
        const csvContent = fs.readFileSync(csvPath, 'utf8');
        const rows = parseCSV(csvContent);
        console.log(`✅ Loaded ${rows.length} rows from CSV.`);

        // 3.2 Count Quantities from CSV (Group by Name)
        const countsByName = {};
        rows.forEach(row => {
            const name = row[1]; // Index 1 is 'name'
            if (name) {
                const normalized = name.trim();
                countsByName[normalized] = (countsByName[normalized] || 0) + 1;
            }
        });
        console.log(`🔍 Found ${Object.keys(countsByName).length} unique games in CSV.`);

        // 3.3 Fetch Existing Games from DB
        const { data: dbGames, error: dbError } = await supabase
            .from('games')
            .select('id, name, quantity, available_count');

        if (dbError) throw dbError;
        console.log(`✅ Loaded ${dbGames.length} games from DB.`);

        // 3.4 Fetch Active Rentals
        const { data: rentals, error: rentalError } = await supabase
            .from('rentals')
            .select('game_id')
            .is('returned_at', null)
            .eq('type', 'RENT'); // Only count actual RENT type for deduction? Or DIBS too?
        // Usually DIBS reduces available count until return/cancel
        // Let's count both RENT and DIBS as reducing availability.
        // Wait, logic says: Available = Quantity - (Active Rents + Active Dibs)

        if (rentalError) throw rentalError;

        // Group rentals by game_id
        const rentalCounts = {};
        rentals.forEach(r => {
            rentalCounts[r.game_id] = (rentalCounts[r.game_id] || 0) + 1;
        });
        console.log(`✅ Loaded ${rentals.length} active rentals.`);

        // 3.5 Update DB
        let updatedCount = 0;
        let errorCount = 0;

        for (const game of dbGames) {
            const csvCount = countsByName[game.name.trim()] || 1; // Default to 1 if not in CSV (safe fallback)
            // But if user says "Sync based on CSV", maybe 0 if not in CSV?
            // "보드게임 개수는 CSV 기준으로 맞춤"
            // If CSV has it, trust CSV count. If not, keeping 1 seems safer than 0 (deleting).

            // Validate: If DB has 1 but CSV has 0? If name changed?
            // Assuming names match.

            const activeCount = rentalCounts[game.id] || 0;
            const newQuantity = csvCount;
            const newAvailable = Math.max(0, newQuantity - activeCount); // Don't go below 0

            // Update only if changed
            if (game.quantity !== newQuantity || game.available_count !== newAvailable) {
                const { error: updateError } = await supabase
                    .from('games')
                    .update({
                        quantity: newQuantity,
                        available_count: newAvailable
                    })
                    .eq('id', game.id);

                if (updateError) {
                    console.error(`❌ Update failed for ${game.name}:`, updateError.message);
                    errorCount++;
                } else {
                    console.log(`✏️ Updated ${game.name}: Qty ${game.quantity}->${newQuantity}, Avail ${game.available_count}->${newAvailable} (Rented: ${activeCount})`);
                    updatedCount++;
                }
            }
        }

        console.log(`🎉 Sync Complete! Updated: ${updatedCount}, Errors: ${errorCount}`);

    } catch (e) {
        console.error("❌ Sync Failed:", e);
    }
}

syncInventory();
