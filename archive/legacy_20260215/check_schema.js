
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey || '')) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be an active publishable key');
}
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking rentals column 'renter_name'...");
    const { error: errRentals } = await supabase.from('rentals').select('renter_name').limit(1);
    if (errRentals) console.log("rentals.renter_name does NOT exist:", errRentals.message);
    else console.log("rentals.renter_name exists!");

    console.log("Checking game_copies columns...");
    const { data: copyData, error: copyError } = await supabase.from('game_copies').select('*').limit(1);
    if (copyData && copyData.length > 0) {
        console.log("game_copies columns:", Object.keys(copyData[0]));
    } else {
        console.log("game_copies empty or error:", copyError?.message);
        // if empty, try to select 'note' or 'renter'
        const { error: errNote } = await supabase.from('game_copies').select('note').limit(1);
        if (errNote) console.log("game_copies.note does NOT exist");
        else console.log("game_copies.note exists!");
    }
}

check().then(() => console.log("Done."));
