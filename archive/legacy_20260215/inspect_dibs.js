
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hptvqangstiaatdtusrg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwdHZxYW5nc3RpYWF0ZHR1c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNjcyNDIsImV4cCI6MjA4NDg0MzI0Mn0.zUA1hXHeEblta3kQG6A3ltbKgRfzByDLc6suC_D3ZZc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    const targetGames = ["감자의 꿈", "그러는 너는 어떤데?"];

    console.log("=== Inspecting Games ===");
    const { data: games, error: gameError } = await supabase
        .from('games')
        .select('*')
        .in('name', targetGames);

    if (gameError) {
        console.error("Game Fetch Error:", gameError);
        return;
    }

    for (const game of games) {
        console.log(`\n[Game] ${game.name} (ID: ${game.id})`);

        // 1. Check Copies
        const { data: copies, error: copyError } = await supabase
            .from('game_copies')
            .select('*')
            .eq('game_id', game.id);

        if (copyError) console.error("Copy Fetch Error:", copyError);
        else {
            console.log("  Copies:", copies);
        }

        // 2. Check Active Rentals (Rent or Dibs)
        const { data: rentals, error: rentalError } = await supabase
            .from('rentals')
            .select('*')
            .eq('game_name', game.name) // or use join with copy_id if safer, but name is easy for quick check
            .is('returned_at', null);

        if (rentalError) console.error("Rental Fetch Error:", rentalError);
        else {
            console.log("  Active Rentals:", rentals);
        }
    }
}

inspect();
