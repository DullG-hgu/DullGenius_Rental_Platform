
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hptvqangstiaatdtusrg.supabase.co';
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey || '')) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be an active publishable key');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixOrphans() {
    console.log("=== Fixing Orphaned Reservations (via RPC) ===");

    const { data: reservedCopies, error: fetchError } = await supabase
        .from('game_copies')
        .select('copy_id, game_id, status')
        .eq('status', 'RESERVED');

    if (fetchError) {
        console.error("Fetch Error:", fetchError);
        return;
    }

    console.log(`Found ${reservedCopies.length} reserved copies.`);

    for (const copy of reservedCopies) {
        const { data: rentals, error: rentalError } = await supabase
            .from('rentals')
            .select('rental_id')
            .eq('copy_id', copy.copy_id)
            .is('returned_at', null);

        if (rentalError) {
            console.error(`Error checking rentals for copy ${copy.copy_id}:`, rentalError);
            continue;
        }

        if (!rentals || rentals.length === 0) {
            console.log(`[Orphan Found] CopyObj:`, copy);

            if (!copy.game_id) {
                console.error("  Game ID is missing! Skipping.");
                continue;
            }

            // Retry RPC with explicit params
            const { data, error: rpcError } = await supabase.rpc('admin_return_copy', {
                p_game_id: copy.game_id
            });

            if (rpcError) {
                console.error(`  RPC Failed for copy ${copy.copy_id}:`, rpcError);
                // Try alternate signature if old version?
                // const { data: altData, error: altError } = await supabase.rpc('admin_return_copy', { 
                //    p_game_id: copy.game_id, p_user_id: null 
                // });
            } else {
                console.log(`  RPC Success:`, data);
            }
        }
    }
    console.log("=== Done ===");
}

fixOrphans();
