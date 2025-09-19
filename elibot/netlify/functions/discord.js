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
// הסתברות פיצוץ קבועה
const ROULETTE_BUST_CHANCE = 0.20;

// מכפיל אקספוננציאלי עד לסיבוב הנתון:
// round=1 => 1.1
// round=2 => 1.1 * 1.2 = 1.32
// round=3 => 1.1 * 1.2 * 1.3 = 1.716
const rouletteCompoundedMultiplier = (round) => {
  let m = 1;
  for (let k = 1; k <= round; k++) {
    m *= (1 + k / 10);
  }
  return m;
};


/* ========== LOTTERY HELPERS / EMBEDS ========== */
// תאריך/שעה בפורמט ישראלי עם פסיק בין תאריך לשעה: DD/MM/YY, HH:MM
function fmtIL(dt) {
  const d = new Date(dt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// אמבד פתוח של לוטו – מציג זמן סגירה קשיח ולא "24 שעות"
function lotteryOpenEmbed(number, closeAtISO, total, lines) {
  return {
    content: "",
    embeds: [{
      title: `🎉  **הגרלה מספר #${number}**  🎉`,
      description:
        `⏳ **נסגרת ב־** ${fmtIL(closeAtISO)}\n` +
        `─────────────────────────────\n` +
        `💰 **סכום זכייה:** ${total} מטבעות\n` +
        `─────────────────────────────\n` +
        `🎲 **סיכויי זכייה:**\n` +
        (lines.length ? lines.join("\n") : "_עדיין אין משתתפים נוספים_") +
        `\n─────────────────────────────\n` +
        `🔔 **לקבלת עדכונים על הגרלות עתידיות**\n` +
        `||<@&1418491938704719883>||`,
      color: 0xFF9900,
      footer: { text: `⌚︎ מסתיים ב־ ${fmtIL(closeAtISO)}` }
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
  // תשובה אפמרלית שלא משנה את ההודעה המקורית
  return json({ type: 4, data: { flags: 64, content: `❌ רק מי שהתחיל את הרולטה יכול ללחוץ.` } });
}


  if (action === "hit") {
    // בדיקת פיצוץ
    const bust = Math.random() < ROULETTE_BUST_CHANCE;
    if (bust) {
      // ההימור ירד בתחילת המשחק — אין החזר
      return json({
        type: 7,
        data: { content: `🎰 **BUST!** הפסדת (${bet}).`, components: [] }
      });
    }

    // עברנו לסיבוב הבא
    const nextRound = round + 1;
    const payout = Math.floor(bet * rouletteCompoundedMultiplier(nextRound));
    const profit = payout - bet;

    return json({
      type: 7,
      data: {
        // מציגים רק את הרווח, ללא מכפיל וללא טקסט על הסיכוי
content: `🎰 רולטה — סכום נוכחי: **${payout}**`,
        components: [
          row([
            btn(`roulette:${ownerId}:${bet}:${nextRound}:hit`, "המשך", 1),
            btn(`roulette:${ownerId}:${bet}:${nextRound}:cash`, "צא", 3),
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
        // מציגים רווח וסכום שחוזר, בלי מכפילים/סיכון
        content: `💵 יצאת עם **${payout}** (רווח **+${profit}**). יתרה: **${newBal}**`,
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

  // היוצר לא יכול להצטרף לעצמו — אפמרלי
  if (userId === creatorId) {
    return json({ type: 4, data: { flags: 64, content: `❌ לא ניתן להצטרף לקרב של עצמך.` } });
  }

  // בדיקות כספים — אפמרלי בלבד (לא נוגעים בהודעת הקרב)
  const a = await getUser(creatorId);
  const b = await getUser(userId);
  if ((a.balance ?? 100) < amount) {
    return json({ type: 4, data: { flags: 64, content: `❌ <@${creatorId}> אין מספיק מטבעות כדי לקיים את הקרב כרגע.` } });
  }
  if ((b.balance ?? 100) < amount) {
    return json({ type: 4, data: { flags: 64, content: `❌ אין לך מספיק מטבעות להצטרפות (נדרש ${amount}).` } });
  }

  // מחייבים את שני הצדדים
  await setUser(creatorId, { balance: (a.balance ?? 100) - amount });
  await setUser(userId,     { balance: (b.balance ?? 100) - amount });

  // מגרילים זוכה ומזכים בפרס
  const winner = Math.random() < 0.5 ? creatorId : userId;
  const w = await getUser(winner);
  const prize = amount * 2;
  await setUser(winner, { balance: (w.balance ?? 100) + prize });

  // כאן כן עורכים את הודעת הקרב (type:7) כדי להציג תוצאה ולסגור כפתורים
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

// custom_id: "fight_cancel:creatorId:amount"
if (cid.startsWith("fight_cancel:")) {
  const [, creatorId, amountStr] = cid.split(":");
  const amount = parseInt(amountStr, 10);

  // רק היוצר רשאי לבטל — אפמרלי למי שלא
  if (userId !== creatorId) {
    return json({ type: 4, data: { flags: 64, content: `❌ רק יוצר הקרב יכול לבטל אותו.` } });
  }

  // עדכון הודעה: ביטול, הסרת כפתורים (כאן כן עורכים את ההודעה)
  return json({
    type: 7,
    data: {
      content: `🥊 הקרב על **${amount}** בוטל על ידי <@${creatorId}>.`,
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
        return json({ type: 4, data: { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — ניצחת! +${amount}. יתרה: **${balance}**` } });
      } else if (userRoll < botRoll) {
        balance -= amount;
        await SUPABASE.from("users").upsert({ id: userId, balance });
        return json({ type: 4, data: { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — עוד ניצחון לאלי -${amount}. יתרה: **${balance}**` } });
      } else {
        return json({ type: 4, data: { content: `🎲 תיקו! אתה: **${userRoll}**, אלי: **${botRoll}** — אין שינוי (יתרה: ${balance})` } });
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
/* ----- roulette amount ----- */
if (cmd === "roulette") {
  const amount = parseInt(opts.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    return json({ type: 4, data: { content: `❌ סכום הימור לא תקין.` } });
  }

  const u = await getUser(userId);
  if ((u.balance ?? 100) < amount) {
    return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` } });
  }

  // מחייבים את ההימור בתחילת המשחק
  await setUser(userId, { balance: (u.balance ?? 100) - amount });

  // מתחילים בסיבוב 1 — כבר יש ×1.1
  const round = 1;
  const payout = Math.floor(amount * rouletteCompoundedMultiplier(round)); // amount * 1.1

  return json({
    type: 4,
    data: {
      // מציגים רק את הסכום הכולל (כולל ההימור), בלי מכפילים/סיכוי
      content: `🎰 רולטה — סכום נוכחי: **${payout}**`,
      components: [
        row([
          btn(`roulette:${userId}:${amount}:${round}:hit`,  "המשך", 1),
          btn(`roulette:${userId}:${amount}:${round}:cash`, "צא",    3),
        ])
      ]
    }
  });
}

    /* ----- fight amount ----- */
    /* ----- fight amount ----- */
if (cmd === "fight") {
  const amount = parseInt(opts.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    return json({ type: 4, data: { content: `❌ סכום לא תקין.` } });
  }

  // יוצר הודעה עם Join ו-Cancel; החיוב נעשה רק בעת Join
  return json({
    type: 4,
    data: {
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
    }
  });
}


    /* ----- lottery amount ----- */
/* ----- lottery amount ----- */
/* ----- lottery amount ----- */
if (cmd === "lottery") {
  const amount = parseInt(opts.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    // שגיאה מהירה (אפמרלית) אם הסכום לא תקין
    return json({ type: 4, data: { flags: 64, content: "❌ סכום לא תקין." } });
  }

  // >>> ACK מיידי כדי לא להיתקע על 3 שניות
  const ack = { type: 4, data: { flags: 64, content: `🎟️ מעבד את ההשתתפות שלך (${amount})...` } };

  (async () => {
    try {
      // 1) אם קיימת הגרלה פתוחה שפג תוקפה – נסגור ונכריז זוכה
      const { data: open } = await SUPABASE
        .from("lotteries")
        .select("id,status,close_at,message_id,number")
        .eq("status","open")
        .maybeSingle();

      if (open && open.close_at && Date.now() > new Date(open.close_at).getTime()) {
        const { data: rows } = await SUPABASE
          .from("lottery_entries")
          .select("user_id,amount")
          .eq("lottery_id", open.id);

        const totalPast = (rows || []).reduce((s, r) => s + r.amount, 0);
        if (totalPast > 0 && rows?.length) {
          // בחירת זוכה פרופורציונית לסכום שהכניסו
          let roll = Math.random() * totalPast;
          let winner = rows[0].user_id;
          for (const r of rows) { roll -= r.amount; if (roll <= 0) { winner = r.user_id; break; } }

          const w = await getUser(winner);
          await setUser(winner, { balance: (w.balance ?? 100) + totalPast });

          // פרסום הזוכה – מציגים מספר גרלה, לא ID
          await editOrPostLotteryMessage(open, lotteryWinnerEmbed(open.number, winner, totalPast));
        }
        // נסגרת סופית
        await SUPABASE.from("lotteries").update({ status: "closed" }).eq("id", open.id);
      }

      // 2) בדיקת יתרה
      const u = await getUser(userId);
      if ((u.balance ?? 100) < amount) {
        // לא ניתן לשלוח follow-up אפמרלי אחרי ACK, אז שולחים הודעה רגילה בערוץ
        await postChannelMessage(channelId, { content: `<@${userId}> ❌ אין לך מספיק מטבעות (יתרה: ${u.balance}).` });
        return;
      }

      // 3) לוקחים/פותחים הגרלה פתוחה (לא נוגעים ב-close_at אחרי שנקבע)
      let { data: lot } = await SUPABASE
        .from("lotteries")
        .select("id,status,message_id,close_at,number")
        .eq("status","open")
        .maybeSingle();

      if (!lot) {
        const closeAt = new Date(Date.now() + 24*60*60*1000).toISOString();
        const { data: newLot } = await SUPABASE
          .from("lotteries")
          .insert({ status: "open", close_at: closeAt })
          .select()
          .single();
        lot = newLot;
      }

      // 4) מחייבים את המשתמש
      await setUser(userId, { balance: (u.balance ?? 100) - amount });

      // 5) מוסיפים/מעדכנים כניסה מצטברת
      const { data: existing } = await SUPABASE
        .from("lottery_entries")
        .select("id,amount")
        .eq("lottery_id", lot.id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        await SUPABASE.from("lottery_entries")
          .update({ amount: existing.amount + amount })
          .eq("id", existing.id);
      } else {
        await SUPABASE.from("lottery_entries")
          .insert({ lottery_id: lot.id, user_id: userId, amount });
      }

      // 6) מחשבים סכומים ומעדכנים את הודעת ההגרלה בערוץ הייעודי
      const { data: entries } = await SUPABASE
        .from("lottery_entries")
        .select("user_id,amount")
        .eq("lottery_id", lot.id);

      const total = (entries || []).reduce((s, e) => s + e.amount, 0);

      // איחוד לפי משתמש (גם אם בעתיד יהיו ריבוי רשומות)
      const sums = new Map();
      for (const e of entries || []) sums.set(e.user_id, (sums.get(e.user_id) || 0) + e.amount);

      const lines = [];
      for (const [uid, amt] of sums) {
        const pct = total ? Math.round((amt / total) * 100) : 100;
        lines.push(`<@${uid}> → ${pct}%`);
      }

      // חשוב: האמבד החדש מקבל גם את close_at כדי להציג זמן סגירה קשיח
      await editOrPostLotteryMessage(lot, lotteryOpenEmbed(lot.number, lot.close_at, total, lines));

      // 7) אישור בערוץ שבו השתמשו בפקודה
      await postChannelMessage(channelId, { content: `🎟️ <@${userId}> נכנס/ה להגרלה מספר #${lot.number} עם **${amount}**.` });
    } catch (e) {
      console.log("lottery async error:", e?.message || e);
    }
  })();

  // מחזירים את ה־ACK המיידי
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











