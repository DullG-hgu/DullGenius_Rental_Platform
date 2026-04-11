
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// .env 파일 로드
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const BUCKET_NAME = 'game-images';

async function fixBucketPolicy() {
    console.log(`Checking bucket '${BUCKET_NAME}' public status...`);

    // 1. Get Bucket Info
    const { data: bucket, error } = await supabase
        .storage
        .getBucket(BUCKET_NAME);

    if (error) {
        console.error('Failed to get bucket info:', error);
        return;
    }

    console.log('Current Bucket Config:', bucket);

    if (bucket.public) {
        console.log('✅ Bucket is already PUBLIC.');
    } else {
        console.log('❌ Bucket is PRIVATE. Switching to PUBLIC...');

        // 2. Update Bucket to Public
        const { data: updated, error: updateError } = await supabase
            .storage
            .updateBucket(BUCKET_NAME, {
                public: true
            });

        if (updateError) {
            console.error('Failed to update bucket:', updateError);
        } else {
            console.log('✅ Bucket successfully updated to PUBLIC!');
            console.log('New Config:', updated);
        }
    }
}

fixBucketPolicy();
