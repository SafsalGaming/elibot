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
// המולטיפלייר עולה ב-0.1 כל סיבוב: 1.1, 1.2, 1.3 ...
const ROULETTE_BUST_CHANCE = 0.20;
const rouletteMultiplier = (round) => 1 + round / 10; // round 1 => 1.1

/* ========== LOTTERY HELPERS / EMBEDS ========== */
function nowIL() {
  return new Date().toLocaleString("he-IL", { hour12: false });
}
function lotteryOpenEmbed(number, total, lines) {
  return {
    content: "",
    embeds: [{
      title: `🎉  **הגרלה מספר #${number}**  🎉`,
      description:
        `${nowIL()}\n` +
        `─────────────────────────────\n` +
        `💰 **סכום זכייה:** ${total} מטבעות\n` +
        `─────────────────────────────\n` +
        `🎲 **סיכויי זכייה:**\n` +
        (lines.length ? lines.join("\n") : "_עדיין אין משתתפים נוספים_") +
        `\n─────────────────────────────\n` +
        `🔔 **לקבלת עדכונים על הגרלות עתידיות**\n` +
        `||<@&1418491938704719883>||`,
      color: 0xFF9900,
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
    const username = body.member?.user?.username || body.user?.username || "חבר";

    // ROULETTE buttons
    // custom_id: "roulette:ownerId:bet:round:action"
    if (cid.startsWith("roulette:")) {
      const [, ownerId, betStr, roundStr, action] = cid.split(":");
      const bet   = parseInt(betStr, 10);
      const round = parseInt(roundStr, 10);
      if (userId !== ownerId) {
        return json({ type: 7, data: { content: `❌ רק מי שהתחיל את הרולטה יכול ללחוץ.`, components: [] } });
      }

      if (action === "hit") {
        // בדיקת bust
        const bust = Math.random() < ROULETTE_BUST_CHANCE;
        if (bust) {
          // הפסד — אין החזר, הכסף כבר ירד בתחילת המשחק
          return json({
            type: 7,
            data: {
              content: `🎰 **BUST!** הפסדת את ההימור (${bet}).`,
              components: []
            }
          });
        }
        // הגדלת סיבוב
        const nextRound = round + 1;
        const mult = rouletteMultiplier(nextRound);
        const potential = Math.floor(bet * mult);
        return json({
          type: 7,
          data: {
            content: `🎰 רולטה — הימור: **${bet}** | סיבוב: **${nextRound}** | מכפיל: **x${mult.toFixed(1)}** | מזומן נוכחי אם תצא: **${potential}**`,
            components: [
              row([
                btn(`roulette:${ownerId}:${bet}:${nextRound}:hit`, "המשך (20% להפסיד)", 1),
                btn(`roulette:${ownerId}:${bet}:${nextRound}:cash`, "צא עם הכסף", 3),
              ])
            ]
          }
        });
      }

      if (action === "cash") {
        const mult = rouletteMultiplier(round);
        const payout = Math.floor(bet * mult);
        const u = await getUser(userId);
        await setUser(userId, { balance: (u.balance ?? 100) + payout });
        return json({
          type: 7,
          data: {
            content: `💵 יצאת עם **${payout}** (מכפיל x${mult.toFixed(1)} על הימור ${bet}). יתרה: **${(u.balance ?? 100) + payout}**`,
            components: []
          }
        });
      }

      return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
    }

    // FIGHT join button
    // custom_id: "fight_join:creatorId:amount"
    if (cid.startsWith("fight_join:")) {
      const [, creatorId, amountStr] = cid.split(":");
      const amount = parseInt(amountStr, 10);
      if (userId === creatorId) {
        return json({ type: 7, data: { content: `❌ צריך משתתף אחר שיצטרף.`, components: [] } });
      }

      // בדיקת כספים לשני הצדדים
      const a = await getUser(creatorId);
      const b = await getUser(userId);
      if ((a.balance ?? 100) < amount) {
        return json({ type: 7, data: { content: `❌ <@${creatorId}> אין מספיק מטבעות. הקרב בוטל.`, components: [] } });
      }
      if ((b.balance ?? 100) < amount) {
        return json({ type: 7, data: { content: `❌ אין לך מספיק מטבעות להצטרפות.`, components: [] } });
      }

      // מחייבים שני הצדדים
      await setUser(creatorId, { balance: (a.balance ?? 100) - amount });
      await setUser(userId,     { balance: (b.balance ?? 100) - amount });

      // קובעים מנצח אקראי ומזכים ב-2*amount
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

    // לא זוהתה פעולה
    return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
  }

  /* ===== SLASH COMMANDS ===== */
  if (body?.type === 2) {
    const cmd  = body.data.name;
    const opts = Object.fromEntries((body.data.options || []).map(o => [o.name, o.value]));
    const userId   = body.member?.user?.id || body.user?.id;
    const username = body.member?.user?.username || body.user?.username || "חבר";
    const display  = body.member?.nick || body.member?.user?.global_name || body.user?.global_name || username;
    const channelId = body.channel_id;

    await ensureUsernameOnce(userId, display);

    // הגבלת ערוץ להימורים (לוטו מותר בכל ערוץ)
    if (GAMBLING_CMDS.has(cmd) && channelId && channelId !== ALLOWED_GAMBLING_CHANNEL) {
      return json({ type: 4, data: { content: `🎲 הימורים רק בחדר <#${ALLOWED_GAMBLING_CHANNEL}>` } });
    }

    /* ----- balance ----- */
    if (cmd === "balance") {
      const u = await getUser(userId);
      return json({ type: 4, data: { content: `💰 ${username}, היתרה שלך: **${u.balance}** מטבעות` } });
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
        return json({ type: 4, data: { content: `⏳ כבר לקחת היום. נסה שוב בעוד ${h} שעות ו־${m} דקות.` } });
      }
      const balance = (u.balance ?? 100) + 50;
      await setUser(userId, { balance, last_daily: new Date(now).toISOString() });
      return json({ type: 4, data: { content: `🎁 קיבלת **50** מטבעות! יתרה חדשה: **${balance}**` } });
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
        return json({ type: 4, data: { content: `⏳ עבדת לא מזמן. נסה שוב בעוד ${m} דק׳ ו־${s} שניות.` } });
      }
      const balance = (u.balance ?? 100) + 10;
      await setUser(userId, { balance, last_work: new Date(now).toISOString() });
      return json({ type: 4, data: { content: `👷 קיבלת **10** מטבעות על עבודה. יתרה: **${balance}**` } });
    }

    /* ----- coinflip choice amount ----- */
    if (cmd === "coinflip") {
      const choice = String(opts.choice || "").toLowerCase();
      const amount = parseInt(opts.amount, 10);
      if (!["heads", "tails"].includes(choice)) {
        return json({ type: 4, data: { content: `❌ בחירה לא תקינה. בחר heads או tails.` } });
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        return json({ type: 4, data: { content: `❌ סכום הימור לא תקין.` } });
      }
      const u = await getUser(userId);
      if (amount > u.balance) return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` } });

      const flip = Math.random() < 0.5 ? "heads" : "tails";
      const won  = (flip === choice);
      const balance = u.balance + (won ? amount : -amount);
      await setUser(userId, { balance });
      return json({
        type: 4,
        data: { content: `🪙 יצא **${flip}** — ${won ? `זכית! +${amount}` : `הפסדת... -${amount}`} | יתרה: **${balance}**` }
      });
    }

    /* ----- dice amount (d6 vs bot) ----- */
    if (cmd === "dice") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        return json({ type: 4, data: { content: `❌ סכום הימור לא תקין.` } });
      }
      const { data } = await SUPABASE.from("users").select("balance").eq("id", userId).maybeSingle();
      let balance = data?.balance ?? 100;
      if (balance < amount) return json({ type: 4, data: { content: `${username}, אין לך מספיק מטבעות 🎲` } });

      const userRoll = Math.floor(Math.random() * 6) + 1;
      const botRoll  = Math.floor(Math.random() * 6) + 1;
      if (userRoll > botRoll) {
        balance += amount;
        await SUPABASE.from("users").upsert({ id: userId, balance });
        return json({ type: 4, data: { content: `🎲 אתה: **${userRoll}**, בוט: **${botRoll}** — ניצחת! +${amount}. יתרה: **${balance}**` } });
      } else if (userRoll < botRoll) {
        balance -= amount;
        await SUPABASE.from("users").upsert({ id: userId, balance });
        return json({ type: 4, data: { content: `🎲 אתה: **${userRoll}**, בוט: **${botRoll}** — הפסדת... -${amount}. יתרה: **${balance}**` } });
      } else {
        return json({ type: 4, data: { content: `🎲 תיקו! אתה: **${userRoll}**, בוט: **${botRoll}** — אין שינוי (יתרה: ${balance})` } });
      }
    }

    /* ----- give user amount ----- */
    if (cmd === "give") {
      const target = opts.user;
      const amount = parseInt(opts.amount, 10);
      if (!target || target === userId) return json({ type: 4, data: { content: `❌ משתמש לא תקין.` } });
      if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: `❌ סכום לא תקין.` } });

      const u = await getUser(userId);
      if (u.balance < amount) return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` } });

      const receiver = await getUser(target);
      await setUser(userId, { balance: u.balance - amount });
      await setUser(target,  { balance: (receiver.balance ?? 100) + amount });

      return json({ type: 4, data: { content: `🤝 העברת **${amount}** ל־<@${target}>. היתרה שלך: **${u.balance - amount}**, שלו: **${(receiver.balance ?? 100) + amount}**` } });
    }

    /* ----- top ----- */
    if (cmd === "top") {
      const { data } = await SUPABASE.from("users").select("id, balance").order("balance", { ascending: false }).limit(10);
      if (!data || data.length === 0) return json({ type: 4, data: { content: `אין עדיין נתונים ללוח הובלות.` } });
      const lines = data.map((u, i) => `**${i + 1}.** <@${u.id}> — ${u.balance}`);
      return json({ type: 4, data: { content: `🏆 טופ 10 עשירים:\n${lines.join("\n")}` } });
    }

    /* ----- roulette amount ----- */
    if (cmd === "roulette") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: `❌ סכום הימור לא תקין.` } });

      const u = await getUser(userId);
      if ((u.balance ?? 100) < amount) return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` } });

      // מחייבים את ההימור בתחילת המשחק
      await setUser(userId, { balance: (u.balance ?? 100) - amount });

      // Round 1 (x1.1)
      const round = 1;
      const mult = rouletteMultiplier(round);
      const potential = Math.floor(amount * mult);

      // הודעה עם כפתורים; אפשר גם להפוך ל־ephemeral אם תרצה flags: 64
      return json({
        type: 4,
        data: {
          content: `🎰 רולטה — הימור: **${amount}** | סיבוב: **${round}** | מכפיל: **x${mult.toFixed(1)}** | מזומן אם תצא: **${potential}**`,
          components: [
            row([
              btn(`roulette:${userId}:${amount}:${round}:hit`,  "המשך (20% להפסיד)", 1),
              btn(`roulette:${userId}:${amount}:${round}:cash`, "צא עם הכסף", 3),
            ])
          ]
        }
      });
    }

    /* ----- fight amount ----- */
    if (cmd === "fight") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: `❌ סכום לא תקין.` } });

      // רק מודיע ויוצר כפתור הצטרפות; חיוב נעשה בעת הלחיצה
      return json({
        type: 4,
        data: {
          content:
            `🥊 <@${userId}> מזמין לקרב על **${amount}**. לחצו "Join" כדי להצטרף — הזוכה יקבל **${amount * 2}**.`,
          components: [
            row([ btn(`fight_join:${userId}:${amount}`, "Join", 1) ])
          ]
        }
      });
    }

    /* ----- lottery amount ----- */
    if (cmd === "lottery") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        return json({ type: 4, data: { flags: 64, content: "❌ סכום לא תקין." } });
      }

      // תשובת בזק כדי לא לקבל "did not respond"
      const ack = { type: 4, data: { flags: 64, content: `🎟️ מעבד כניסה/תוספת להגרלה עם ${amount}...` } };

      (async () => {
        // אם קיימת הגרלה פתוחה שפג תוקפה — נסגור ונכריז זוכה
        const { data: open } = await SUPABASE
          .from("lotteries")
          .select("id, status, close_at, message_id")
          .eq("status", "open")
          .maybeSingle();

        if (open && open.close_at && Date.now() > new Date(open.close_at).getTime()) {
          const { data: rows } = await SUPABASE
            .from("lottery_entries")
            .select("user_id, amount")
            .eq("lottery_id", open.id);

          const total = (rows || []).reduce((s, r) => s + r.amount, 0);
          if (total > 0 && rows?.length) {
            let roll = Math.random() * total;
            let winner = rows[0].user_id;
            for (const r of rows) { roll -= r.amount; if (roll <= 0) { winner = r.user_id; break; } }
            const w = await getUser(winner);
            await setUser(winner, { balance: (w.balance ?? 100) + total });
            await editOrPostLotteryMessage(open, lotteryWinnerEmbed(open.id, winner, total));
            await SUPABASE.from("lotteries").update({ status: "closed" }).eq("id", open.id);
          } else {
            await SUPABASE.from("lotteries").update({ status: "closed" }).eq("id", open.id);
          }
        }

        // בדיקת יתרה של המשתמש
        const u = await getUser(userId);
        if ((u.balance ?? 100) < amount) {
          // שולחים הודעה פרטית למשתמש (לא עוצר את ה-ack שכבר נשלח)
          await postChannelMessage(channelId, { content: `<@${userId}> ❌ אין לך מספיק מטבעות (יתרה: ${u.balance}).` });
          return;
        }

        // לוקחים/פותחים הגרלה
        let { data: lot } = await SUPABASE
          .from("lotteries")
          .select("id, status, message_id, close_at")
          .eq("status", "open")
          .maybeSingle();

        if (!lot) {
          const { data: newLot } = await SUPABASE
            .from("lotteries")
            .insert({ status: "open", total: 0, close_at: new Date(Date.now() + 24*60*60*1000).toISOString() })
            .select()
            .single();
          lot = newLot;
        }

        // מחייבים ומוסיפים כניסה (מצטבר)
        await setUser(userId, { balance: (u.balance ?? 100) - amount });
        const { data: existing } = await SUPABASE
          .from("lottery_entries").select("*").eq("lottery_id", lot.id).eq("user_id", userId).maybeSingle();
        if (existing) {
          await SUPABASE.from("lottery_entries").update({ amount: existing.amount + amount }).eq("id", existing.id);
        } else {
          await SUPABASE.from("lottery_entries").insert({ lottery_id: lot.id, user_id: userId, amount });
        }

        // סיכומים ועדכון הודעה
        const { data: entries } = await SUPABASE
          .from("lottery_entries").select("user_id, amount").eq("lottery_id", lot.id);
        const total = (entries || []).reduce((s, e) => s + e.amount, 0);

        // מאחדים סכומים לפי משתמש
        const sums = new Map();
        for (const e of entries || []) sums.set(e.user_id, (sums.get(e.user_id) || 0) + e.amount);

        const lines = [];
        for (const [uid, amt] of sums) {
          const pct = total ? Math.round((amt / total) * 100) : 100;
          lines.push(`<@${uid}> → ${pct}%`);
        }

        if (!lot.message_id) {
          const msg = await postChannelMessage(LOTTERY_CHANNEL_ID, lotteryOpenEmbed(lot.id, total, lines));
          await SUPABASE.from("lotteries").update({ message_id: msg.id }).eq("id", lot.id);
        } else {
          await editChannelMessage(LOTTERY_CHANNEL_ID, lot.message_id, lotteryOpenEmbed(lot.id, total, lines));
        }

        // אישור קצר בערוץ שבו השתמשו בפקודה
        await postChannelMessage(channelId, { content: `🎟️ <@${userId}> נכנס/ה להגרלה #${lot.id} עם **${amount}**.` });
      })().catch(e => console.log("lottery async err:", e?.message || e));

      return json(ack);
    }

    // לא מוכר
    return json({ type: 4, data: { content: `הפקודה לא מוכרת.` } });
  }

  // אחרת
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 5 })
  };
}

