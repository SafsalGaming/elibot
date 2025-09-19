// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";

const SUPABASE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// חדרי יעוד
const ALLOWED_GAMBLING_CHANNEL = "1418196736958005361"; // רולטה ופייט רק כאן
const LOTTERY_CHANNEL_ID       = "1418491365259477084"; // הודעת הלוטו תתפרסם/תתעדכן כאן

const GAMBLING_CMDS = new Set(["coinflip", "dice", "daily", "work", "roulette", "fight"]);

const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

const API = "https://discord.com/api/v10";
const BOT_HEADERS = {
  "Authorization": `Bot ${process.env.DISCORD_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (functions,1.0)"
};

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

/* ---------- users ---------- */
async function ensureUsernameOnce(userId, displayName) {
  if (!displayName) return;
  const { data } = await SUPABASE.from("users").select("username").eq("id", userId).maybeSingle();
  if (!data) {
    await SUPABASE.from("users").insert({ id: userId, username: displayName, balance: 100, last_daily: null, last_work: null });
    return;
  }
  if (data.username == null) {
    await SUPABASE.from("users").update({ username: displayName }).eq("id", userId).is("username", null);
  }
}
async function getUser(userId) {
  const { data } = await SUPABASE.from("users").select("*").eq("id", userId).maybeSingle();
  if (!data) {
    const row = { id: userId, balance: 100, last_daily: null, last_work: null };
    await SUPABASE.from("users").insert(row);
    return row;
  }
  return data;
}
async function setUser(userId, patch) {
  await SUPABASE.from("users").upsert({ id: userId, ...patch });
}

/* ---------- discord helpers ---------- */
function btn(custom_id, label, style = 1, disabled = false) {
  return { type: 2, style, label, custom_id, disabled };
}
function row(components) { return { type: 1, components }; }

async function postChannelMessage(channelId, payload) {
  const r = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST", headers: BOT_HEADERS, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`post msg ${r.status}: ${await r.text()}`);
  return r.json();
}
async function editChannelMessage(channelId, messageId, payload) {
  const r = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH", headers: BOT_HEADERS, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`edit msg ${r.status}: ${await r.text()}`);
  return r.json();
}

/* ---------- roulette helpers ---------- */
function nextMultiplier(roundNext) { return 1 + (roundNext / 10); }

/* ---------- lottery embeds ---------- */
function formatIL(dt = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const d  = new Date(dt);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} | ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function lotteryOpenEmbed(number, total, lines) {
  return {
    content: "",
    embeds: [{
      title: `🎉  **הגרלה מספר #${number}**  🎉`,
      description:
        `${formatIL()} \n─────────────────────────────\n` +
        `💰 **סכום זכייה:** ${total} מטבעות\n` +
        `─────────────────────────────\n` +
        `🎲 **סיכויי זכייה:**\n` +
        (lines.length ? lines.join("\n") : "_עדיין אין משתתפים נוספים_") +
        `\n─────────────────────────────\n` +
        `🔔 **לקבלת עדכונים על הגרלות עתידיות**\n` +
        `||<@&1418491938704719883>||`,
      color: 16754176,
      footer: { text: "⏳ נסגרת אוטומטית אחרי 24 שעות" }
    }]
  };
}
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

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const sig = event.headers["x-signature-ed25519"];
  const ts  = event.headers["x-signature-timestamp"];
  if (!sig || !ts) return { statusCode: 401, body: "Missing signature headers" };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64") : Buffer.from(event.body || "", "utf8");

  let ok = false;
  try { ok = await verifyKey(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY); } catch {}
  if (!ok) return { statusCode: 401, body: "Bad request signature" };

  const body = JSON.parse(raw.toString("utf8"));

  if (body?.type === 1) return json({ type: 1 }); // PING

  /* ---------- Button interactions ---------- */
  if (body?.type === 3 && body.data?.component_type === 2) {
    // ... (החלק של רולטה/פייט נשאר כמו קודם – לא נוגע בלוטו כאן)
    // כדי לחסוך מקום: השאר את מה שנתתי לך קודם עבור fight_join / roulette_hit / roulette_cash
    // (הקוד הזה לא השתנה בהקשר לדרישה הנוכחית)
    return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
  }

  /* ---------- Slash ---------- */
  if (body?.type === 2) {
    const cmd  = body.data.name;
    const opts = Object.fromEntries((body.data.options || []).map(o => [o.name, o.value]));
    const userId   = body.member?.user?.id || body.user?.id;
    const username = body.member?.user?.username || body.user?.username || "חבר";
    const display  = body.member?.nick || body.member?.user?.global_name || body.user?.global_name || username;
    const channelId = body.channel_id;
    const guildId   = body.guild_id;

    await ensureUsernameOnce(userId, display);

    // הגבלת חדר (לא חל על lottery)
    if (GAMBLING_CMDS.has(cmd) && channelId && channelId !== ALLOWED_GAMBLING_CHANNEL) {
      return json({ type: 4, data: { content: `🎲 הימורים רק בחדר <#${ALLOWED_GAMBLING_CHANNEL}>` } });
    }

    // ... (balance/daily/work/coinflip/dice/give/top/roulette/fight – כפי שנתתי לך קודם, ללא שינוי)

    /* ----- Lottery: פקודה יחידה עם amount ----- */
    if (cmd === "lottery") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        return json({ type: 4, data: { content: "❌ סכום לא תקין." } });
      }
      const u = await getUser(userId);
      if (u.balance < amount) return json({ type: 4, data: { content: "❌ אין לך מספיק מטבעות." } });

      // קבל/צור הגרלה פתוחה
      let { data: lotto } = await SUPABASE.from("lotteries")
        .select("*").eq("is_open", true).order("created_at", { ascending: true }).limit(1).maybeSingle();

      if (!lotto) {
        // יוצרים הגרלה חדשה + הודעת EMBED
        const createdRes = await SUPABASE.from("lotteries").insert({ channel_id: LOTTERY_CHANNEL_ID }).select().maybeSingle();
        lotto = createdRes.data;
        const embed = lotteryOpenEmbed(lotto.number, 0, []);
        const msg = await postChannelMessage(LOTTERY_CHANNEL_ID, embed);
        await SUPABASE.from("lotteries").update({ message_id: msg.id }).eq("id", lotto.id);
        lotto.message_id = msg.id;
      }

      // מחייב את המשתמש
      await setUser(userId, { balance: u.balance - amount });

      // מוסיף/מעדכן כניסה (מצטבר)
      const { data: existing } = await SUPABASE
        .from("lottery_entries").select("*").eq("lottery_id", lotto.id).eq("user_id", userId).maybeSingle();
      if (existing) {
        await SUPABASE.from("lottery_entries").update({ amount: existing.amount + amount }).eq("id", existing.id);
      } else {
        await SUPABASE.from("lottery_entries").insert({ lottery_id: lotto.id, user_id: userId, amount });
      }

      // מחשבים סכום כולל ואחוזים ומעדכנים EMBED
      const { data: entries } = await SUPABASE
        .from("lottery_entries").select("user_id, amount").eq("lottery_id", lotto.id);
      const total = (entries || []).reduce((s, e) => s + e.amount, 0);
      const lines = (entries || []).map(e => {
        const pct = total ? Math.round((e.amount / total) * 100) : 0;
        return `<@${e.user_id}> → ${pct}%`;
      });
      await editChannelMessage(lotto.channel_id, lotto.message_id, lotteryOpenEmbed(lotto.number, total, lines));

      return json({ type: 4, data: { content: `🎟️ נכנסת/הוספת **${amount}** להגרלה #${lotto.number}.` } });
    }

    return json({ type: 4, data: { content: `הפקודה לא מוכרת.` } });
  }

  return json({ type: 5 });
}
