require('dotenv').config(); // CWD(루트)의 .env 로드
const { createClient } = require('@supabase/supabase-js');
// Node 18+ has native fetch. If on older node, uncomment below:
// const fetch = require('node-fetch');

// 1. Supabase Client 설정
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Error: Missing Supabase Environment Variables");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 2. 연체자 조회 함수
async function checkOverdueRentals() {
    console.log("🔍 Checking for overdue rentals...");

    const now = new Date();

    // 반납되지 않은(rentals.returned_at IS NULL) 기록 중 due_date가 지난 것 조회
    // active rentals first
    // Due date comparison might need ISO string
    const { data: rentals, error } = await supabase
        .from('rentals')
        .select(`
            id: rental_id,
            renter_name,
            due_date,
            game_name,
            user: profiles(name, phone)
        `)
        .is('returned_at', null)
        .lt('due_date', now.toISOString());

    if (error) {
        console.error("❌ Supabase Error:", error);
        return [];
    }

    return rentals || [];
}

// 3. 디스코드 알림 발송 함수
async function sendDiscordNotification(overdueList) {
    if (!discordWebhookUrl) {
        console.log("⚠️ Warning: DISCORD_WEBHOOK_URL is not set. Skipping notification.");
        console.log("--- Local Debug Output ---");
        console.log(JSON.stringify(overdueList, null, 2));
        return;
    }

    if (overdueList.length === 0) {
        console.log("✅ No overdue rentals found.");
        return;
    }

    console.log(`🚀 Sending notification for ${overdueList.length} overdue items...`);

    // 메시지 구성 (Embed 방식)
    const embeds = overdueList.slice(0, 10).map((item, index) => {
        const dueDate = new Date(item.due_date);
        const diffDays = Math.floor((Date.now() - dueDate) / (1000 * 60 * 60 * 24));
        const renter = item.renter_name || item.user?.name || "알수없음";
        const contact = item.user?.phone || "알 수 없는 전화번호";

        return {
            title: "🚨 연체 발생 알림",
            description: `### ${item.game_name}에 대한 연체 알림이 발생했습니다.\n\n**연체자** : ${renter} (${contact})\n**대상 게임** : ${item.game_name}\n**연체 일수** : D+${diffDays}일`,
            color: 15158332, // Red color
            timestamp: new Date().toISOString()
        };
    });

    const payload = {
        username: process.env.DISCORD_BOT_NAME || "덜지니어스 연체 관리자",
        avatar_url: process.env.DISCORD_AVATAR_URL || "https://cdn-icons-png.flaticon.com/512/3523/3523063.png",
        content: `🚨 **연체 현황 브리핑 (${new Date().toLocaleDateString()})**\n현재 **${overdueList.length}건**의 미반납 연체 기록이 있습니다.${overdueList.length > 10 ? ' (최대 10건까지만 표시됩니다.)' : ''}`,
        embeds: embeds
    };

    try {
        const response = await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log("✅ Discord Notification Sent Successfully!");
        } else {
            const errText = await response.text();
            console.error(`❌ Failed to send Discord notification: ${response.status} ${errText}`);
        }
    } catch (e) {
        console.error("❌ Network Error:", e);
    }
}

// 4. 실행
(async () => {
    try {
        const overdueList = await checkOverdueRentals();
        await sendDiscordNotification(overdueList);
    } catch (e) {
        console.error("Unexpected Error:", e);
        process.exit(1);
    }
})();
