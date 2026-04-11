import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
// const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use this if anon fails, but we want to test anon/user context if possible.

// Actually, testing with service role key will tell us if data exists.
// Testing with anon key (and no login) will definitely fail if RLS is on.
// We need to simulate the admin user login, which is hard in a simple script without credentials.

// So let's first check if data EXITS using service role key (if available in env)
// If not, we'll try to just read with what we have.

// Since I cannot easily get the user's session token here, 
// I will create a script that runs in the browser console context if possible, OR
// I will just use the Service Role Key to confirm table content first.

const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey);

async function checkRoles() {
    console.log("Checking user_roles table...");

    // 1. Check if we can read user_roles
    const { data, error } = await supabase
        .from('user_roles')
        .select('*');

    if (error) {
        console.error("Error fetching user_roles:", error);
    } else {
        console.log(`Found ${data.length} roles.`);
        console.log(data);
    }

    // 2. Check profiles
    const { data: profiles, error: pError } = await supabase
        .from('profiles')
        .select('id, name')
        .limit(5);

    if (pError) {
        console.error("Error fetching profiles:", pError);
    } else {
        console.log("Profiles sample:", profiles);
    }
}

checkRoles();
