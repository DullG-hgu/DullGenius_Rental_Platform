import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(supabaseKey || '')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must use sb_secret_ format');
}
const supabase = createClient(supabaseUrl, supabaseKey);

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
