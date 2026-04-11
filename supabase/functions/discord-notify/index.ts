// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const DISCORD_WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL')

serve(async (req) => {
    if (!DISCORD_WEBHOOK_URL) {
        return new Response(JSON.stringify({ error: 'DISCORD_WEBHOOK_URL not set' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
        })
    }

    try {
        const payload = await req.json()
        console.log("Webhook received:", payload)

        const { type, table, record, schema } = payload

        // 알림 메시지 구성
        let message = null;

        if (type === 'INSERT') {
            if (table === 'profiles') {
                message = {
                    title: "👤 신규 부원 가입",
                    content: `**${record.name}** (${record.student_id}) 님이 가입했습니다.`,
                    color: 3447003 // Blue
                }
            } else if (table === 'rentals') {
                // Rentals logic
                // We might need to fetch game name if it's not in the record (it is in 'game_name' usually)
                const renter = record.renter_name || "회원";
                const game = record.game_name || "알 수 없는 게임";
                message = {
                    title: "📦 대여 발생",
                    content: `**${renter}** 님이 **${game}**을(를) 대여했습니다.`,
                    color: 3066993 // Green
                }
            } else if (table === 'logs' && record.action_type === 'MISS') {
                message = {
                    title: "💡 입고 요청 (아쉬워요)",
                    content: `누군가 **${record.details}** 게임 입고를 희망합니다.`,
                    color: 16776960 // Yellow
                }
            }
        }

        if (message) {
            await sendToDiscord(message)
            return new Response(JSON.stringify({ message: 'Notification sent' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            })
        }

        return new Response(JSON.stringify({ message: 'No notification needed' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        })

    } catch (error) {
        console.error(error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
        })
    }
})

async function sendToDiscord(msg: any) {
    const payload = {
        username: Deno.env.get('DISCORD_BOT_NAME') || "덜지니어스 알림봇",
        avatar_url: Deno.env.get('DISCORD_AVATAR_URL') || "https://cdn-icons-png.flaticon.com/512/3523/3523063.png",
        embeds: [{
            title: msg.title,
            description: msg.content,
            color: msg.color,
            footer: { text: "Real-time Notification" },
            timestamp: new Date().toISOString()
        }]
    }

    const res = await fetch(DISCORD_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })

    if (!res.ok) {
        throw new Error(`Discord API Error: ${await res.text()}`)
    }
}
