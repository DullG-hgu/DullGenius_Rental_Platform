
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// .env 파일 로드
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey || '')) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY must be an active publishable key');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getSampleUrl() {
    const { data, error } = await supabase
        .from('games')
        .select('image')
        .limit(1)
        .single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Sample URL:', data.image);
    }
}

getSampleUrl();
