// netlify/functions/cron-lottery.js
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";

const SUPABASE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const API = "https://discord.com/api/v10";
const BOT_HEADERS = {
  "Authorization": `Bot ${process.env.DISCORD_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (cron,1.0)"
};

function lotteryWinnerEmbed(number, winnerId, total) {
  return {
    content: "",
    embeds: [{
      title: `**🏆 הזוכה בהגרלה #${number} הוא: **`,
      description:
        `─────────────────────\n <@${winnerId}> 🎉\n` +
        `─────────────────────\n**💰 פרס:** ${total} מטבעות`,
      color: 16754176
    }]
  };
}

async function editMessage(channelId, messageId, payload) {
  const r = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH", headers: BOT_HEADERS, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`edit msg ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function handler() {
  // כל ההגרלות הפתוחות מבוגרות מ-24 שעות
  const { data: old } = await SUPABASE
    .from("lotteries")
    .select("*")
    .eq("is_open", true)
    .lt("created_at", new Date(Date.now() - 24*60*60*1000).toISOString());

  if (!old || !old.length) {
    return { statusCode: 200, body: "no lotteries to close" };
  }

  for (const lotto of old) {
    const { data: entries } = await SUPABASE
      .from("lottery_entries").select("user_id, amount").eq("lottery_id", lotto.id);

    const total = (entries || []).reduce((s, e) => s + e.amount, 0);
    if (!total) {
      // אין משתתפים – נסגור בלי זוכה
      await SUPABASE.from("lotteries")
        .update({ is_open: false, closed_at: new Date().toISOString() })
        .eq("id", lotto.id);
      // אפשר גם לערוך הודעה ל"בטלה" אם תרצה
      continue;
    }

    // בחירה משוקללת
    const r = Math.floor(Math.random() * total);
    let acc = 0, winner = entries[0].user_id;
    for (const e of entries) { acc += e.amount; if (r < acc) { winner = e.user_id; break; } }

    // זיכוי מנצח
    const { data: winnerRow } = await SUPABASE.from("users").select("balance").eq("id", winner).maybeSingle();
    const newBal = (winnerRow?.balance ?? 100) + total;
    await SUPABASE.from("users").upsert({ id: winner, balance: newBal });

    // סגירה ועדכון הודעה
    await SUPABASE.from("lotteries")
      .update({ is_open: false, closed_at: new Date().toISOString() })
      .eq("id", lotto.id);

    await editMessage(lotto.channel_id, lotto.message_id, lotteryWinnerEmbed(lotto.number, winner, total));
  }

  return { statusCode: 200, body: "closed" };
}
