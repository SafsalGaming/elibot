// netlify/functions/lottery-cron.js
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";

const SUPABASE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const API = "https://discord.com/api/v10";
const BOT_HEADERS = {
  "Authorization": `Bot ${process.env.DISCORD_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (functions,1.0)"
};

const LOTTERY_CHANNEL_ID = "1418491365259477084";
const LOTTERY_ROLE_ID    = "1418491938704719883";

function fmtIL(dt) {
  const d = new Date(dt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function postChannelMessage(channelId, payload) {
  const r = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST", headers: BOT_HEADERS, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`post msg ${r.status}: ${await r.text()}`);
  return r.json();
}

function winnerEmbed(number, winnerId, total) {
  return {
    embeds: [{
      title: `**🏆 הזוכה בהגרלה #${number} הוא: **`,
      description:
        `─────────────────────\n <@${winnerId}> 🎉\n` +
        `─────────────────────\n**💰 פרס:** ${total} מטבעות`,
      color: 0xFF9900
    }]
  };
}

export default async function handler(req, res) {
  try {
    const { data: openLots } = await SUPABASE
      .from("lotteries")
      .select("id, status, close_at, created_at, number")
      .eq("status", "open");

    const now = Date.now();
    for (const lot of (openLots || [])) {
      if (!lot.close_at) continue;
      if (now <= new Date(lot.close_at).getTime()) continue;

      const { data: rows } = await SUPABASE
        .from("lottery_entries")
        .select("user_id, amount")
        .eq("lottery_id", lot.id);

      const total = (rows || []).reduce((s, r) => s + r.amount, 0);

      if (total > 0 && rows?.length) {
        let roll = Math.random() * total;
        let winner = rows[0].user_id;
        for (const r of rows) { roll -= r.amount; if (roll <= 0) { winner = r.user_id; break; } }

        // credit winner
        const { data: udata } = await SUPABASE.from("users").select("balance").eq("id", winner).maybeSingle();
        const bal = udata?.balance ?? 100;
        await SUPABASE.from("users").upsert({ id: winner, balance: bal + total });

        // announce winner as a NEW message with a real mention in content
        await postChannelMessage(LOTTERY_CHANNEL_ID, {
          content: `||<@&${LOTTERY_ROLE_ID}>||\n<@${winner}>`,
          ...winnerEmbed(lot.number, winner, total)
        });
      } else {
        await postChannelMessage(LOTTERY_CHANNEL_ID, {
          content: `||<@&${LOTTERY_ROLE_ID}>||`,
          embeds: [{ title: `**הגרלה #${lot.number} נסגרה ללא משתתפים**`, description: `לא היו כניסות בהגרלה זו.`, color: 0xFF9900 }]
        });
      }

      await SUPABASE
        .from("lotteries")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", lot.id);
    }

    res.status(200).send("ok");
    return;
  } catch (e) {
    console.log("lottery-cron error:", e?.message || e);
    res.status(500).send("error");
    return;
  }
}
