
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// .env 파일 로드
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY; // 관리자 키가 필요할 수도 있음 (삭제 시)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // 서비스 롤 키 (권한 우회)

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkStorage() {
    console.log('Checking "game-images" bucket...');

    const { data, error } = await supabase
        .storage
        .from('game-images')
        .list();

    if (error) {
        console.error('Error listing files:', error);
        return;
    }

    if (data.length === 0) {
        console.log('Bucket is empty.');
    } else {
        console.log(`Found ${data.length} files:`);
        data.forEach(file => {
            console.log(`- ${file.name} (${(file.metadata.size / 1024).toFixed(2)} KB)`);
        });
    }
}

checkStorage();
