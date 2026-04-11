
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://hptvqangstiaatdtusrg.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwdHZxYW5nc3RpYWF0ZHR1c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNjcyNDIsImV4cCI6MjA4NDg0MzI0Mn0.zUA1hXHeEblta3kQG6A3ltbKgRfzByDLc6suC_D3ZZc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugDibsToRent() {
    console.log("=== Debugging Dibs -> Rent Flow (CLI) ===");

    // 1. Setup: Create a fresh Dibs for a test game to ensure clean state
    // First, find an AVAILABLE copy
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
    console.log(`target Game: ${gameName} (ID: ${gameId})`);

    // Create a DIBS record (simulate user action)
    // We'll use a random user ID if possible, or just a dummy UUID if we can't find one.
    // Ideally we assume an anonymous or admin user for this test if we skip user_id check in creation.
    // Actually, 'dibs_any_copy' requires auth.
    // Let's manually insert a DIBS record to bypass auth requirement for setup
    const testUserId = '00000000-0000-0000-0000-000000000000'; // Dummy UUID for testing
    const renterName = "TestUser_" + Date.now();

    const { data: dibsRent, error: dibsError } = await supabase
        .from('rentals')
        .insert({
            user_id: testUserId,
            copy_id: testCopy.copy_id,
            game_name: gameName,
            renter_name: renterName,
            borrowed_at: new Date().toISOString(),
            due_date: new Date(Date.now() + 30 * 60000).toISOString(),
            type: 'DIBS'
        })
        .select()
        .single();

    if (dibsError) {
        console.error("❌ Setup Failed: Could not create test DIBS.", dibsError);
        return;
    }

    console.log("✅ Setup: Created DIBS record:", dibsRent.rental_id);

    // Update copy status to RESERVED manually to match reality
    await supabase.from('game_copies').update({ status: 'RESERVED' }).eq('copy_id', testCopy.copy_id);


    // 2. Execute: Call admin_rent_copy (The Function Under Test)
    console.log(`\nExecuting admin_rent_copy(gameId=${gameId}, renterName=${renterName})...`);

    const { data: rpcData, error: rpcError } = await supabase.rpc('admin_rent_copy', {
        p_game_id: gameId,
        p_renter_name: renterName,
        p_user_id: testUserId
    });

    if (rpcError) {
        console.error("❌ RPC Failed:", rpcError);
        return;
    }
    console.log("RPC Result:", rpcData);

    // 3. Verify: Check the DB state
    console.log("\n=== Verifying DB State ===");

    // A. Old DIBS should be returned (returned_at IS NOT NULL)
    const { data: oldDibs } = await supabase
        .from('rentals')
        .select('*')
        .eq('rental_id', dibsRent.rental_id)
        .single();

    if (oldDibs.returned_at) {
        console.log("✅ Verified: Old DIBS record is closed (returned_at set).");
    } else {
        console.error("❌ FAILED: Old DIBS record is still open!");
    }

    // B. New RENT record should exist
    const { data: newRent } = await supabase
        .from('rentals')
        .select('*')
        .eq('copy_id', testCopy.copy_id)
        .eq('type', 'RENT')
        .is('returned_at', null)
        .order('borrowed_at', { ascending: false })
        .limit(1);

    if (newRent && newRent.length > 0) {
        console.log("✅ Verified: New RENT record exists:", newRent[0].rental_id);
    } else {
        console.error("❌ FAILED: New RENT record NOT found!");
    }

    // C. Copy Status should be RENTED
    const { data: copyCheck } = await supabase
        .from('game_copies')
        .select('status')
        .eq('copy_id', testCopy.copy_id)
        .single();

    if (copyCheck.status === 'RENTED') {
        console.log("✅ Verified: Copy status is 'RENTED'.");
    } else {
        console.error(`❌ FAILED: Copy status is '${copyCheck.status}' (expected 'RENTED').`);
    }

    // Cleanup
    console.log("\nCleaning up test data...");
    await supabase.from('rentals').delete().eq('user_id', testUserId);
    await supabase.from('game_copies').update({ status: 'AVAILABLE' }).eq('copy_id', testCopy.copy_id);
}

debugDibsToRent();
