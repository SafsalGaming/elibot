// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";

const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

/* ========== CONFIG ========== */
const SUPABASE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ערוצי יעד
const ALLOWED_GAMBLING_CHANNEL = "1418196736958005361"; // הימורים (roulette / fight / coinflip / dice / daily / work)
const LOTTERY_CHANNEL_ID       = "1418491365259477084"; // כאן נשלחת/מתעדכנת הודעת הלוטו
const LOTTERY_ROLE_ID          = "1418491938704719883"; // רול עדכוני הגרלות

// פקודות שנעולות לערוץ ההימורים (לוטו מותר בכל ערוץ)
const GAMBLING_CMDS = new Set([
  "coinflip", "dice", "daily", "work", "roulette", "fight"
]);

const API = "https://discord.com/api/v10";
const BOT_HEADERS = {
  "Authorization": `Bot ${process.env.DISCORD_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (functions,1.0)"
};
const APP_ID = process.env.DISCORD_APP_ID; // ודא שזה קיים בסביבה!

const NOAUTH_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": BOT_HEADERS["User-Agent"],
};

/* ===== Universal defer + edit helpers (public) ===== */
async function deferPublic(body) {
  // Show "thinking..." publicly (not ephemeral) to avoid 3s timeout
  await fetch(`${API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify({ type: 5 }), // public defer
  });
}
async function editOriginal(body, payload) {
  const appId = body.application_id || process.env.DISCORD_APP_ID;
  if (!appId) { console.log("editOriginal: missing application_id"); return; }
  const r = await fetch(`${API}/webhooks/${appId}/${body.token}/messages/@original`, {
    method: "PATCH",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.log("editOriginal failed:", r.status, await r.text());
}

/* ===== (kept) old helpers used elsewhere if needed ===== */
async function deferEphemeralInteraction(body) {
  await fetch(`${API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify({ type: 5, data: { flags: 64 } }),
  });
}
async function deleteOriginalInteraction(body) {
  const appId = body.application_id || process.env.DISCORD_APP_ID;
  if (!appId) { console.log("deleteOriginal: missing application_id"); return; }
  await new Promise(r => setTimeout(r, 500));
  const r = await fetch(`${API}/webhooks/${appId}/${body.token}/messages/@original`, {
    method: "DELETE",
    headers: NOAUTH_HEADERS,
  });
  if (!r.ok) console.log("deleteOriginal failed:", r.status, await r.text());
}
async function sendFollowupEphemeral(body, payload) {
  const appId = body.application_id || process.env.DISCORD_APP_ID;
  if (!appId) { console.log("followup: missing application_id"); return; }
  const r = await fetch(`${API}/webhooks/${appId}/${body.token}`, {
    method: "POST",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify({ ...payload, flags: 64 }),
  });
  if (!r.ok) console.log("followup failed:", r.status, await r.text());
}

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

/* ========== DB HELPERS ========== */
async function ensureUsernameOnce(userId, displayName) {
  if (!displayName) return;
  const { data } = await SUPABASE.from("users").select("username").eq("id", userId).maybeSingle();
  if (!data) {
    await SUPABASE.from("users").insert({
      id: userId, username: displayName, balance: 100, last_daily: null, last_work: null
    });
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

/* ========== DISCORD HELPERS ========== */
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

/* ========== ROULETTE HELPERS ========== */
const ROULETTE_BUST_CHANCE = 0.20;
const rouletteCompoundedMultiplier = (round) => {
  let m = 1;
  for (let k = 1; k <= round; k++) m *= (1 + k / 10);
  return m;
};

/* ========== LOTTERY HELPERS / EMBEDS ========== */
// DD/MM/YY, HH:MM
function fmtIL(dt) {
  const d = new Date(dt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// אמבד פתוח — שורה 2 = זמן פתיחה בלבד, פוטר = זמן סיום
function lotteryOpenEmbed(number, startAtISO, closeAtISO, total, lines) {
  return {
    content: "",
    embeds: [{
      title: `🎉  **הגרלה מספר #${number}**  🎉`,
      description:
        `${fmtIL(startAtISO)}\n` +
        `─────────────────────────────\n` +
        `💰 **סכום זכייה:** ${total} מטבעות\n` +
        `─────────────────────────────\n` +
        `🎲 **סיכויי זכייה:**\n` +
        (lines.length ? lines.join("\n") : "_עדיין אין משתתפים נוספים_") +
        `\n─────────────────────────────\n` +
        `🔔 **לקבלת עדכונים על הגרלות עתידיות**\n` +
        `||<@&${LOTTERY_ROLE_ID}>||`,
      color: 0xFF9900,
      footer: { text: `⏳ מסתיים ב־ ${fmtIL(closeAtISO)}` }
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
      color: 0xFF9900
    }]
  };
}

async function editOrPostLotteryMessage(lot, payload) {
  if (lot.message_id) {
    await editChannelMessage(LOTTERY_CHANNEL_ID, lot.message_id, payload);
  } else {
    const msg = await postChannelMessage(LOTTERY_CHANNEL_ID, payload);
    await SUPABASE.from("lotteries").update({ message_id: msg.id }).eq("id", lot.id);
  }
}

/* ===== Close any expired open lotteries (used here on-demand; cron also provided) ===== */
async function closeExpiredLotteriesAndAnnounce() {
  const { data: openLots } = await SUPABASE
    .from("lotteries")
    .select("id, status, close_at, created_at, message_id, number")
    .eq("status", "open");

  const now = Date.now();
  for (const lot of (openLots || [])) {
    if (!lot.close_at) continue;
    if (now <= new Date(lot.close_at).getTime()) continue;

    // gather entries
    const { data: rows } = await SUPABASE
      .from("lottery_entries")
      .select("user_id, amount")
      .eq("lottery_id", lot.id);

    const totalPast = (rows || []).reduce((s, r) => s + r.amount, 0);

    if (totalPast > 0 && rows?.length) {
      let roll = Math.random() * totalPast;
      let winner = rows[0].user_id;
      for (const r of rows) {
        roll -= r.amount;
        if (roll <= 0) { winner = r.user_id; break; }
      }
      // pay winner
      const w = await getUser(winner);
      await setUser(winner, { balance: (w.balance ?? 100) + totalPast });

      // announce in a NEW separate message, with real mention in content
      await postChannelMessage(LOTTERY_CHANNEL_ID, {
        content: `||<@&${LOTTERY_ROLE_ID}>||\n<@${winner}>`,
        ...lotteryWinnerEmbed(lot.number, winner, totalPast)
      });
    } else {
      // no entries — announce quietly that lottery closed with no winner
      await postChannelMessage(LOTTERY_CHANNEL_ID, {
        content: `||<@&${LOTTERY_ROLE_ID}>||`,
        embeds: [{
          title: `**הגרלה #${lot.number} נסגרה ללא משתתפים**`,
          description: `לא היו כניסות בהגרלה זו.`,
          color: 0xFF9900
        }]
      });
    }

    // close it
    await SUPABASE
      .from("lotteries")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", lot.id);
  }
}

/* ========== HANDLER ========== */
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

  /* ===== PING ===== */
  if (body?.type === 1) return {
    statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: 1 })
  };

  /* ===== BUTTON INTERACTIONS ===== */
  if (body?.type === 3 && body.data?.component_type === 2) {
    const cid = body.data.custom_id || "";
    const userId   = body.member?.user?.id || body.user?.id;

    // ROULETTE buttons
    if (cid.startsWith("roulette:")) {
      const [, ownerId, betStr, roundStr, action] = cid.split(":");
      const bet   = parseInt(betStr, 10);
      const round = parseInt(roundStr, 10);

      if (userId !== ownerId) {
        return json({ type: 4, data: { flags: 64, content: `❌ רק מי שהתחיל את הרולטה יכול ללחוץ.` } });
      }

      if (action === "hit") {
        const bust = Math.random() < ROULETTE_BUST_CHANCE;
        if (bust) {
          return json({ type: 7, data: { content: `🎰 **BUST!** הפסדת (${bet}).`, components: [] } });
        }
        const nextRound = round + 1;
        const payout = Math.floor(bet * rouletteCompoundedMultiplier(nextRound));
        return json({
          type: 7,
          data: {
            content: `🎰 רולטה — סכום נוכחי: **${payout}**`,
            components: [
              row([
                btn(`roulette:${ownerId}:${bet}:${nextRound}:hit`, "המשך", 3),
                btn(`roulette:${ownerId}:${bet}:${nextRound}:cash`, "צא", 4),
              ])
            ]
          }
        });
      }

      if (action === "cash") {
        const payout = Math.floor(bet * rouletteCompoundedMultiplier(round));
        const profit = payout - bet;
        const u = await getUser(userId);
        const newBal = (u.balance ?? 100) + payout;
        await setUser(userId, { balance: newBal });

        return json({
          type: 7,
          data: {
            content: `💵 יצאת עם **${payout}** (רווח **+${profit}**). יתרה: **${newBal}**`,
            components: []
          }
        });
      }

      return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
    }

    // FIGHT buttons
    if (cid.startsWith("fight_join:")) {
      const [, creatorId, amountStr] = cid.split(":");
      const amount = parseInt(amountStr, 10);

      if (userId === creatorId) {
        return json({ type: 4, data: { flags: 64, content: `❌ לא ניתן להצטרף לקרב של עצמך.` } });
      }
      const a = await getUser(creatorId);
      const b = await getUser(userId);
      if ((a.balance ?? 100) < amount) {
        return json({ type: 4, data: { flags: 64, content: `❌ <@${creatorId}> אין מספיק מטבעות כדי לקיים את הקרב כרגע.` } });
      }
      if ((b.balance ?? 100) < amount) {
        return json({ type: 4, data: { flags: 64, content: `❌ אין לך מספיק מטבעות להצטרפות (נדרש ${amount}).` } });
      }

      await setUser(creatorId, { balance: (a.balance ?? 100) - amount });
      await setUser(userId,     { balance: (b.balance ?? 100) - amount });

      const winner = Math.random() < 0.5 ? creatorId : userId;
      const w = await getUser(winner);
      const prize = amount * 2;
      await setUser(winner, { balance: (w.balance ?? 100) + prize });

      return json({
        type: 7,
        data: {
          content:
            `🥊 קרב על **${amount}**! המשתתפים: <@${creatorId}> מול <@${userId}>.\n` +
            `🏆 הזוכה: <@${winner}> וקיבל **${prize}** מטבעות.`,
          components: []
        }
      });
    }

    if (cid.startsWith("fight_cancel:")) {
      const [, creatorId, amountStr] = cid.split(":");
      const amount = parseInt(amountStr, 10);
      const reqUser = body.member?.user?.id || body.user?.id;

      if (reqUser !== creatorId) {
        return json({ type: 4, data: { flags: 64, content: `❌ רק יוצר הקרב יכול לבטל אותו.` } });
      }
      return json({
        type: 7,
        data: {
          content: `🥊 הקרב על **${amount}** בוטל על ידי <@${creatorId}>.`,
          components: []
        }
      });
    }

    return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
  }

  /* ===== SLASH COMMANDS (ALL DEFER + EDIT) ===== */
  if (body?.type === 2) {
    const cmd  = body.data.name;
    const opts = Object.fromEntries((body.data.options || []).map(o => [o.name, o.value]));
    const userId   = body.member?.user?.id || body.user?.id;
    const username = body.member?.user?.username || body.user?.username || "חבר";
    const display  = body.member?.nick || body.member?.user?.global_name || body.user?.global_name || username;
    const channelId = body.channel_id;

    await ensureUsernameOnce(userId, display);

    // Defer immediately (public) for ALL commands
    await deferPublic(body);

    // Channel restriction (gambling)
    if (GAMBLING_CMDS.has(cmd) && channelId && channelId !== ALLOWED_GAMBLING_CHANNEL) {
      await editOriginal(body, { content: `🎲 הימורים רק בחדר <#${ALLOWED_GAMBLING_CHANNEL}>` });
      return { statusCode: 200, body: "" };
    }

    /* ----- balance ----- */
    if (cmd === "balance") {
      const u = await getUser(userId);
      await editOriginal(body, { content: `💰 ${username}, היתרה שלך: **${u.balance}** מטבעות` });
      return { statusCode: 200, body: "" };
    }

    /* ----- daily (+50 / 24h) ----- */
    if (cmd === "daily") {
      const now = Date.now();
      const u = await getUser(userId);
      const last = u.last_daily ? new Date(u.last_daily).getTime() : 0;
      if (now - last < DAY) {
        const left = DAY - (now - last);
        const h = Math.floor(left / HOUR);
        const m = Math.floor((left % HOUR) / (60 * 1000));
        await editOriginal(body, { content: `⏳ כבר לקחת היום. נסה שוב בעוד ${h} שעות ו־${m} דקות.` });
        return { statusCode: 200, body: "" };
      }
      const balance = (u.balance ?? 100) + 50;
      await setUser(userId, { balance, last_daily: new Date(now).toISOString() });
      await editOriginal(body, { content: `🎁 קיבלת **50** מטבעות! יתרה חדשה: **${balance}**` });
      return { statusCode: 200, body: "" };
    }

    /* ----- work (+10 / 1h) ----- */
    if (cmd === "work") {
      const now = Date.now();
      const u = await getUser(userId);
      const last = u.last_work ? new Date(u.last_work).getTime() : 0;
      if (now - last < HOUR) {
        const left = HOUR - (now - last);
        const m = Math.floor(left / (60 * 1000));
        const s = Math.floor((left % (60 * 1000)) / 1000);
        await editOriginal(body, { content: `⏳ עבדת לא מזמן. נסה שוב בעוד ${m} דק׳ ו־${s} שניות.` });
        return { statusCode: 200, body: "" };
      }
      const balance = (u.balance ?? 100) + 10;
      await setUser(userId, { balance, last_work: new Date(now).toISOString() });
      await editOriginal(body, { content: `👷 קיבלת **10** מטבעות על עבודה. יתרה: **${balance}**` });
      return { statusCode: 200, body: "" };
    }

    /* ----- coinflip ----- */
    if (cmd === "coinflip") {
      const choice = String(opts.choice || "").toLowerCase();
      const amount = parseInt(opts.amount, 10);
      if (!["heads", "tails"].includes(choice)) {
        await editOriginal(body, { content: `❌ בחירה לא תקינה. בחר heads או tails.` });
        return { statusCode: 200, body: "" };
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
        return { statusCode: 200, body: "" };
      }
      const u = await getUser(userId);
      if (amount > u.balance) {
        await editOriginal(body, { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` });
        return { statusCode: 200, body: "" };
      }

      const flip = Math.random() < 0.5 ? "heads" : "tails";
      const won  = (flip === choice);
      const balance = u.balance + (won ? amount : -amount);
      await setUser(userId, { balance });
      await editOriginal(body, { content: `🪙 יצא **${flip}** — ${won ? `זכית! +${amount}` : `הפסדת... -${amount}`} | יתרה: **${balance}**` });
      return { statusCode: 200, body: "" };
    }

    /* ----- dice ----- */
    if (cmd === "dice") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
        return { statusCode: 200, body: "" };
      }
      const { data } = await SUPABASE.from("users").select("balance").eq("id", userId).maybeSingle();
      let balance = data?.balance ?? 100;
      if (balance < amount) {
        await editOriginal(body, { content: `${username}, אין לך מספיק מטבעות 🎲` });
        return { statusCode: 200, body: "" };
      }

      const userRoll = Math.floor(Math.random() * 6) + 1;
      const botRoll  = Math.floor(Math.random() * 6) + 1;
      if (userRoll > botRoll) {
        balance += amount;
        await SUPABASE.from("users").upsert({ id: userId, balance });
        await editOriginal(body, { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — ניצחת! +${amount}. יתרה: **${balance}**` });
      } else if (userRoll < botRoll) {
        balance -= amount;
        await SUPABASE.from("users").upsert({ id: userId, balance });
        await editOriginal(body, { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — עוד ניצחון לאלי -${amount}. יתרה: **${balance}**` });
      } else {
        await editOriginal(body, { content: `🎲 תיקו! אתה: **${userRoll}**, אלי: **${botRoll}** — אין שינוי (יתרה: ${balance})` });
      }
      return { statusCode: 200, body: "" };
    }

    /* ----- give ----- */
    if (cmd === "give") {
      const target = opts.user;
      const amount = parseInt(opts.amount, 10);
      if (!target || target === userId) {
        await editOriginal(body, { content: `❌ משתמש לא תקין.` });
        return { statusCode: 200, body: "" };
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום לא תקין.` });
        return { statusCode: 200, body: "" };
      }

      const u = await getUser(userId);
      if (u.balance < amount) {
        await editOriginal(body, { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` });
        return { statusCode: 200, body: "" };
      }

      const receiver = await getUser(target);
      await setUser(userId, { balance: u.balance - amount });
      await setUser(target,  { balance: (receiver.balance ?? 100) + amount });

      await editOriginal(body, { content: `🤝 העברת **${amount}** ל־<@${target}>. היתרה שלך: **${u.balance - amount}**, שלו: **${(receiver.balance ?? 100) + amount}**` });
      return { statusCode: 200, body: "" };
    }

    /* ----- top ----- */
    if (cmd === "top") {
      const { data } = await SUPABASE.from("users").select("id, balance").order("balance", { ascending: false }).limit(10);
      if (!data || data.length === 0) {
        await editOriginal(body, { content: `אין עדיין נתונים ללוח הובלות.` });
        return { statusCode: 200, body: "" };
      }
      const lines = data.map((u, i) => `**${i + 1}.** <@${u.id}> — ${u.balance}`);
      await editOriginal(body, { content: `🏆 טופ 10 עשירים:\n${lines.join("\n")}` });
      return { statusCode: 200, body: "" };
    }

    /* ----- roulette ----- */
    if (cmd === "roulette") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
        return { statusCode: 200, body: "" };
      }

      const u = await getUser(userId);
      if ((u.balance ?? 100) < amount) {
        await editOriginal(body, { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` });
        return { statusCode: 200, body: "" };
      }

      await setUser(userId, { balance: (u.balance ?? 100) - amount });

      const round = 1;
      const payout = Math.floor(amount * rouletteCompoundedMultiplier(round));

      await editOriginal(body, {
        content: `🎰 רולטה — סכום נוכחי: **${payout}**`,
        components: [
          row([
            btn(`roulette:${userId}:${amount}:${round}:hit`,  "המשך", 3),
            btn(`roulette:${userId}:${amount}:${round}:cash`, "צא",    4),
          ])
        ]
      });
      return { statusCode: 200, body: "" };
    }

    /* ----- fight ----- */
    if (cmd === "fight") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום לא תקין.` });
        return { statusCode: 200, body: "" };
      }

      await editOriginal(body, {
        content:
          `🥊 <@${userId}> מזמין לקרב על **${amount}**. ` +
          `לחצו **Join** כדי להצטרף — הזוכה יקבל **${amount * 2}**.\n` +
          `> רק המכריז יכול ללחוץ **Cancel**.`,
        components: [
          row([
            btn(`fight_join:${userId}:${amount}`, "Join", 1),
            btn(`fight_cancel:${userId}:${amount}`, "Cancel", 4),
          ])
        ]
      });
      return { statusCode: 200, body: "" };
    }

    /* ----- lottery ----- */
    if (cmd === "lottery") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: "❌ סכום לא תקין." });
        return { statusCode: 200, body: "" };
      }

      try {
        // first: auto-close any expired lotteries (so new can open smoothly)
        await closeExpiredLotteriesAndAnnounce();

        // 2) בדיקת יתרה
        const u = await getUser(userId);
        if ((u.balance ?? 100) < amount) {
          await editOriginal(body, { content: `❌ אין לך מספיק מטבעות (יתרה: ${u.balance}).` });
          return { statusCode: 200, body: "" };
        }

        // 3) קח/פתח הגרלה פתוחה אחת
        let { data: lot } = await SUPABASE
          .from("lotteries")
          .select("id,status,message_id,close_at,created_at,number")
          .eq("status","open")
          .maybeSingle();

        // אם יש לוטו פתוח — ודא close_at = created_at + 24h
        if (lot) {
          const targetClose = new Date(new Date(lot.created_at).getTime() + 24*60*60*1000).toISOString();
          if (!lot.close_at || Math.abs(new Date(lot.close_at).getTime() - new Date(targetClose).getTime()) > 2000) {
            await SUPABASE.from("lotteries").update({ close_at: targetClose }).eq("id", lot.id);
            lot.close_at = targetClose;
          }
        }

        let createdNew = false;
        if (!lot) {
          // צור שורה כדי לקבל created_at מה-DB
          const { data: newLot } = await SUPABASE
            .from("lotteries")
            .insert({ status: "open" })
            .select()
            .single();

          const createdAt = new Date(newLot.created_at).getTime();
          const closeAt = new Date(createdAt + 24 * 60 * 60 * 1000).toISOString();

          await SUPABASE.from("lotteries").update({ close_at: closeAt }).eq("id", newLot.id);
          lot = { ...newLot, close_at: closeAt };
          createdNew = true;
        }

        // 4) האם זה המשתתף הראשון לפני ההוספה
        const { count: beforeCount } = await SUPABASE
          .from("lottery_entries")
          .select("id", { count: "exact", head: true })
          .eq("lottery_id", lot.id);
        const wasFirst = createdNew || (beforeCount || 0) === 0;

        // 5) חיוב המשתמש
        await setUser(userId, { balance: (u.balance ?? 100) - amount });

        // 6) הוספה/עדכון כניסה
        const { data: existing } = await SUPABASE
          .from("lottery_entries")
          .select("id,amount")
          .eq("lottery_id", lot.id)
          .eq("user_id", userId)
          .maybeSingle();

        if (existing) {
          await SUPABASE.from("lottery_entries").update({ amount: existing.amount + amount }).eq("id", existing.id);
        } else {
          await SUPABASE.from("lottery_entries").insert({ lottery_id: lot.id, user_id: userId, amount });
        }

        // 7) עדכון הודעת הלוטו בערוץ הייעודי (השארת היסטוריה — לא נוגעים בעתיד בהכרזה)
        const { data: entries } = await SUPABASE
          .from("lottery_entries")
          .select("user_id,amount")
          .eq("lottery_id", lot.id);

        const total = (entries || []).reduce((s, e) => s + e.amount, 0);
        const sums = new Map();
        for (const e of entries || []) sums.set(e.user_id, (sums.get(e.user_id) || 0) + e.amount);

        const lines = [];
        for (const [uid, amt] of sums) {
          const pct = total ? Math.round((amt / total) * 100) : 100;
          lines.push(`<@${uid}> → ${pct}%`);
        }
        await editOrPostLotteryMessage(
          lot,
          lotteryOpenEmbed(lot.number, lot.created_at, lot.close_at, total, lines)
        );

        // 8) במקום הודעות חדשות — עריכת הודעת ה-"thinking" של המשתמש לאישור
        if (wasFirst) {
          await editOriginal(body, { content: `<@${userId}> פתח את הגרלה מספר #${lot.number} עם סכום של **${amount}** מטבעות 💰` });
        } else {
          await editOriginal(body, { content: `<@${userId}> הוסיף **${amount}** מטבעות להגרלה 💰` });
        }

        return { statusCode: 200, body: "" };
      } catch (e) {
        console.log("lottery error:", e?.message || e);
        await editOriginal(body, { content: `⚠️ תקלה זמנית בעיבוד ההגרלה. נסה/י שוב.` });
        return { statusCode: 200, body: "" };
      }
    }

    // לא מוכר
    await editOriginal(body, { content: `הפקודה לא מוכרת.` });
    return { statusCode: 200, body: "" };
  }

  // אחרת (לא כפתור/לא פקודה/כל מקרה לא מזוהה) – החזר ACK ריק
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 5 })
  };
}
