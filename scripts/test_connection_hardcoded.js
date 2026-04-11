
import { createClient } from '@supabase/supabase-js';

// Hardcoding keys from .env to test validity directly
const supabaseUrl = 'https://hptvqangstiaatdtusrg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwdHZxYW5nc3RpYWF0ZHR1c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNjcyNDIsImV4cCI6MjA4NDg0MzI0Mn0.zUA1hXHeEblta3kQG6A3ltbKgRfzByDLc6suC_D3ZZc';

console.log('Testing Supabase Connection with HARDCODED keys...');
console.log('URL:', supabaseUrl);
console.log('Key (abbr):', supabaseKey.substring(0, 15) + '...');

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
    const { data, error } = await supabase
        .from('games')
        .select('count', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Connection Failed:', error.message);
        if (error.code) console.error('Error Code:', error.code);
    } else {
        console.log('✅ Connection Successful! Game count available.');
    }
}

testConnection();
