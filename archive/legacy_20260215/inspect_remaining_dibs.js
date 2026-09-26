
import { createClient } from '@supabase/supabase-js'
import fs from 'fs';

const supabaseUrl = 'https://hptvqangstiaatdtusrg.supabase.co';
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey || '')) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be an active publishable key');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectRemainingDibs() {
    let logBuffer = "=== Inspecting ALL RESERVED Copies ===\n";

    const { data: copies, error } = await supabase
        .from('game_copies')
        .select(`
            copy_id, 
            status,
            games (id, name),
            rentals (
                rental_id,
                user_id,
                renter_name,
                type,
                borrowed_at,
                due_date,
                returned_at
            )
        `)
        .eq('status', 'RESERVED');

    if (error) {
        logBuffer += `Error: ${JSON.stringify(error)}\n`;
        fs.writeFileSync('debug_output.txt', logBuffer);
        return;
    }

    logBuffer += `Found ${copies.length} RESERVED copies.\n`;

    for (const copy of copies) {
        // Find active rentals (not returned)
        const activeRentals = copy.rentals ? copy.rentals.filter(r => r.returned_at === null) : [];
        const gameName = copy.games?.name || 'Unknown';

        logBuffer += `\n[${gameName}] (Copy ID: ${copy.copy_id})\n`;

        if (activeRentals.length === 0) {
            logBuffer += "  ⚠️ ORPHANED! (No active rental)\n";
            // Auto-fix attempt in this script? No, just report.
        } else {
            activeRentals.forEach(r => {
                const dueDate = new Date(r.due_date);
                const now = new Date();
                const isExpired = dueDate < now;
                const minutesLeft = Math.floor((dueDate - now) / 60000);

                logBuffer += `  ✅ Active Rental: ID=${r.rental_id}, User=${r.renter_name || r.user_id}\n`;
                logBuffer += `     Type: ${r.type}\n`;
                logBuffer += `     Due: ${r.due_date} (${isExpired ? 'EXPIRED' : minutesLeft + ' mins left'})\n`;
            });
        }
    }
    fs.writeFileSync('debug_output.txt', logBuffer);
    console.log("Done. Check debug_output.txt");
}

inspectRemainingDibs();
