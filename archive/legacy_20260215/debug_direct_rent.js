
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://hptvqangstiaatdtusrg.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwdHZxYW5nc3RpYWF0ZHR1c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNjcyNDIsImV4cCI6MjA4NDg0MzI0Mn0.zUA1hXHeEblta3kQG6A3ltbKgRfzByDLc6suC_D3ZZc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugDirectRent() {
    console.log("=== Debugging Direct Rent (CLI) ===");

    // 1. Setup: Find an AVAILABLE copy
    const { data: copies, error: findError } = await supabase
        .from('game_copies')
        .select('game_id, copy_id, games(name)')
        .eq('status', 'AVAILABLE')
        .limit(1);

    if (findError || !copies || copies.length === 0) {
        console.error("❌ Setup Failed: No AVAILABLE copies found to test with.", findError);
        return;
    }

    const testCopy = copies[0];
    const gameId = testCopy.game_id;
    const gameName = testCopy.games.name;
    const renterName = "DirectRentTest_" + Date.now().toString().slice(-4);

    console.log(`Target Game: ${gameName} (ID: ${gameId})`);
    console.log(`Renter Name: ${renterName}`);

    // 2. Execute: Call admin_rent_copy 
    console.log(`\nExecuting admin_rent_copy...`);

    const { data: rpcData, error: rpcError } = await supabase.rpc('admin_rent_copy', {
        p_game_id: gameId,
        p_renter_name: renterName,
        p_user_id: null // Testing manual rent (no user ID) to keep it simple
    });

    if (rpcError) {
        console.error("❌ RPC Failed:", rpcError);
        return;
    }
    console.log("RPC Result:", rpcData);

    // 3. Verify: Check if RENT record exists
    console.log("\n=== Verifying DB State ===");

    const { data: newRent } = await supabase
        .from('rentals')
        .select('*')
        .eq('copy_id', testCopy.copy_id)
        .eq('type', 'RENT')
        .eq('renter_name', renterName)
        .is('returned_at', null)
        .limit(1);

    if (newRent && newRent.length > 0) {
        console.log("✅ Verified: New RENT record found:", newRent[0].rental_id);
        console.log("   - Renter Name:", newRent[0].renter_name);
        console.log("   - Borrowed At:", newRent[0].borrowed_at);

        // 4. Cleanup
        console.log("Cleaning up...");
        await supabase.rpc('admin_return_copy', { p_game_id: gameId });
    } else {
        console.error("❌ FAILED: New RENT record NOT found in 'rentals' table!");

        // [DEBUG] Check Copy Status
        const { data: copyCheck } = await supabase
            .from('game_copies')
            .select('status')
            .eq('copy_id', testCopy.copy_id)
            .single();
        console.log(`[DEBUG] Copy Status is: ${copyCheck?.status}`);

        if (copyCheck?.status === 'RENTED') {
            console.log("-> Conclusion: RPC Succeeded (Data Updated), but SELECT failed. RLS Visibility Issue.");
        } else {
            console.log("-> Conclusion: RPC Failed (Transaction Rollback). RLS INSERT Issue.");
        }
    }
}

debugDirectRent();
