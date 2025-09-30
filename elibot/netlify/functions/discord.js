// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";
import { randomUUID } from "crypto";
import { WORDLE_ANSWERS } from "./wordle-words.js";

// כל התהליך עובד לפי שעון ישראל (גם פרסינג של Date בלי timezone)
process.env.TZ = "Asia/Jerusalem";
const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

/* ========== CONFIG ========== */
const SUPABASE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const eliCoin = '<a:FlipEliCoin:1422337837671518228>'; // שם האימוג'י וה־ID האמיתי

// ערוצי יעד
const ALLOWED_GAMBLING_CHANNEL = "1418196736958005361"; // הימורים (roulette / fight / coinflip / dice / daily / work)
const LOTTERY_CHANNEL_ID       = "1418491365259477084"; // כאן נשלחת/מתעדכנת הודעת הלוטו
const UPDATES_ROLE_ID = "1418491938704719883";

// ⭐️ כפתור רול (החזרת הפיצ'ר שנמחק בטעות)
// אפשר להשתמש ב-custom_id: "role:<ROLE_ID>" לכל כפתור כזה
// לדוגמה: role:1418491938704719883  (זה ה-Role של עדכוני הגרלות אצלך)
const ROLE_BUTTON_ENFORCE_CHANNEL = null; // אם רוצים להגביל לערוץ מסוים: "123456789012345678" אחרת השאר null
const ROLE_BUTTON_ENFORCE_MESSAGE = null; // אם רוצים להגביל להודעה מסוימת: "123456789012345678" אחרת השאר null

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
// --- Bias settings (ניצחון שחקן) ---
const COIN_USER_WIN_P = 0.52; // coinflip
const DICE_USER_WIN_P = 0.44; // dice
const DICE_TIE_P = 1/6;       // נשמור תיקו ~16.67% כמו טבעי

const NOAUTH_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": BOT_HEADERS["User-Agent"],
};

async function deferEphemeralInteraction(body) {
  // שולח ACK כדי למנוע timeout (ההודעה תימחק או תעודכן בהמשך)
  await fetch(`${API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify({ type: 5, data: { flags: 64 } }), // defer ephemeral
  });
}
async function deferPublicInteraction(body) {
  await fetch(`${API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify({ type: 5 }), // defer PUBLIC (בלי flags)
  });
}


async function deleteOriginalInteraction(body) {
  const appId = body.application_id || process.env.DISCORD_APP_ID;
  if (!appId) { console.log("deleteOriginal: missing application_id"); return; }
  // להמתין רגע כדי שההודעה תיווצר לפני המחיקה
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

// עריכת הודעת ה-defer המקורית (אם תרצה להשתמש בזה בהמשך)
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

// הוספת רול למשתמש
async function addRoleToMember(guildId, userId, roleId) {
  const r = await fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: BOT_HEADERS,
  });
  if (!r.ok) throw new Error(`addRole ${r.status}: ${await r.text()}`);
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
// ========== WORDLE HELPERS ==========
const WORDLE_MAX_ATTEMPTS = 6;
const WORDLE_TZ = "Asia/Jerusalem";
const ANSWERS = WORDLE_ANSWERS.map(w => w.toLowerCase());

// yyyy-mm-dd לפי אזור זמן ישראל
function ymdInTZ(ts = Date.now(), tz = WORDLE_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(ts);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

// להצגה dd.mm.yyyy
function ddmmyyyyInTZ(ts = Date.now(), tz = WORDLE_TZ) {
  const parts = new Intl.DateTimeFormat("he-IL", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(ts);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${d}.${m}.${y}`;
}
// מחזיר "YYYY-MM-DDTHH:mm:ss" לפי Asia/Jerusalem (ללא Z/אופסט)
function ymdhmsInTZ(ts = Date.now(), tz = WORDLE_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(ts);
  const get = (t) => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

async function getOrCreateWordleGame(userId, ymd) {
  const { data } = await SUPABASE
    .from("wordle_games").select("*")
    .eq("user_id", userId).eq("date", ymd).maybeSingle();

  if (data) return data;

  const solution = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
const row = {
  user_id: userId, date: ymd, solution,
  attempts: 0, finished: false, guesses: [],
  created_at: ymdhmsInTZ(),   // היה new Date().toISOString()
  updated_at: ymdhmsInTZ(),
};

  await SUPABASE.from("wordle_games").insert(row);
  return row;
}

// בלי רשימת allowed: כל מילה של 5 אותיות באנגלית תקפה
function isValidGuess(guess) {
  return typeof guess === "string" && /^[a-z]{5}$/i.test(guess);
}

// לוגיקת צביעה 🟩🟨⬜ כולל כפילויות
function scoreWordle(solution, guess) {
  solution = solution.toLowerCase();
  guess = guess.toLowerCase();

  const res = Array(5).fill("b");
  const solArr = solution.split("");
  const guessArr = guess.split("");

  // ירוקים
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === solArr[i]) {
      res[i] = "g";
      solArr[i] = null;
      guessArr[i] = null;
    }
  }
  // צהובים
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] == null) continue;
    const idx = solArr.indexOf(guessArr[i]);
    if (idx !== -1) {
      res[i] = "y";
      solArr[idx] = null;
    }
  }

  const emoji = res.map(c => c === "g" ? "🟩" : c === "y" ? "🟨" : "⬜").join("");
  return { emoji, marks: res };
}
// מפענח אימוג'ים ל-g/y/b במקרה שאין marks שמורים
function marksFromEmoji(emoji) {
  return [...emoji].map(ch => ch === "🟩" ? "g" : ch === "🟨" ? "y" : "b");
}
// ממיר אותיות A-Z לאימוג'י דגלים אזוריים: 🇦…🇿
function wordToRegionalIndicators(word = "") {
  const A = "A".charCodeAt(0);
  return (word.toUpperCase().slice(0, 5).split("").map(ch => {
    const code = ch.charCodeAt(0);
    if (code >= A && code <= A + 25) {
      // Regional Indicator Symbol Letter A starts at 0x1F1E6
      return String.fromCodePoint(0x1F1E6 + (code - A));
    }
    // fallback: אם תו לא A-Z נחזיר את התו עצמו
    return ch;
  })).join(" ");
}

// מוסיף רווחים בין האימוג'ים של הצבעים (🟩 🟨 ⬜)
function spacedEmoji(emojiStr = "⬜⬜⬜⬜⬜") {
  return [...emojiStr].join(" ");
}
// צבע כמו בדוגמה שלך: 2326507 == #237FEB
const WORDLE_EMBED_COLOR = 2326507;

function wordleEmbed(dateHeb, description) {
  return {
    content: "",
    embeds: [{
      title: `🧩 וורדל היומי • ${dateHeb}`,
      description,
      color: WORDLE_EMBED_COLOR,
      footer: { text: "" }
    }],
    components: []
  };
}


// בונה את היסטוריית הניחושים בשורות כמו: WORD  🟩🟨⬜⬜⬜
function formatHistoryLines(guesses) {
  if (!guesses || !guesses.length) return "_עוד אין ניחושים היום_";
  return guesses
    .map(g => {
      const lettersRow = wordToRegionalIndicators(g.word || "");
      const colorsRow  = spacedEmoji(g.emoji || "⬜⬜⬜⬜⬜");
      return `${lettersRow}\n${colorsRow}`;
    })
    .join("\n\n"); // רווח שורה בין ניסיונות
}


// מסכם אותיות לפי ההיסטוריה:
// 🟩 — כל אות שהופיעה ירוק לפחות פעם אחת
// 🟨 — אות שהופיעה צהוב לפחות פעם אחת ועדיין לא ירוק אף פעם
// ⬜ — אות שהופיעה רק אפור (לא הופיעה כצהוב/ירוק לעולם)
// מציגים רק את האותיות האפורות (שאינן במילה בכלל)
function summarizeLetters(guesses) {
  const green = new Set();
  const yellow = new Set();
  const gray = new Set();

  for (const g of (guesses || [])) {
    const marks = g.marks && Array.isArray(g.marks) ? g.marks : marksFromEmoji(g.emoji || "⬜⬜⬜⬜⬜");
    const word = (g.word || "").toUpperCase();
    for (let i = 0; i < 5; i++) {
      const ch = word[i];
      if (!ch) continue;
      const m = marks[i];

      if (m === "g") {
        green.add(ch); yellow.delete(ch); gray.delete(ch);
      } else if (m === "y") {
        if (!green.has(ch)) yellow.add(ch);
        gray.delete(ch);
      } else { // "b"
        if (!green.has(ch) && !yellow.has(ch)) gray.add(ch);
      }
    }
  }

  if (!gray.size) return "";
  const list = [...gray].sort((a,b)=>a.localeCompare(b)).join(", ");
  return `⬜: ${list}`;
}


// מרנדר את מסך הסטטוס המלא (כמו /wordle) לשימוש גם אחרי כל ניחוש
// מרנדר סטטוס; כש-finished=true לא מציגים ניסיונות/הנחיה/סיכום אותיות
function renderWordleStatus({ dateHeb, attemptsLeft, guesses, finished = false }) {
  const parts = [];
  parts.push(`🧩 וורדל היומי • ${dateHeb}`);
  if (!finished) {
    parts.push(`נשארו לך **${attemptsLeft}** ניסיונות להיום.`);
    parts.push(`נחש עם: \`/wordle word:<xxxxx>\``);
  }
  parts.push(""); // רווח
  parts.push(formatHistoryLines(guesses));
  if (!finished) {
    const summary = summarizeLetters(guesses);
    if (summary) {
      parts.push("");
      parts.push(summary);
    }
  }
  return parts.join("\n").trimEnd();
}


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

// סיכוי למות ברולטה: מתחיל ב־20% וגדל ב־1% בכל סיבוב
const ROULETTE_BASE_PCT = 0.22;   // סיבוב 1 = 20%
const ROULETTE_INCR_PCT = 0.00;   // כל סיבוב +1%

const rouletteBustChance = (round) => {
  const p = ROULETTE_BASE_PCT + (Math.max(1, round) - 1) * ROULETTE_INCR_PCT;
  return Math.min(Math.max(p, 0), 0.99); // בטיחות: לא לעבור 99%
};


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
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: WORDLE_TZ,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dt));
}

// אמבד פתוח של לוטו – שורה 2 = זמן פתיחה בלבד
function lotteryOpenEmbed(number, startAtISO, closeAtISO, total, lines) {
  return {
    content: '||<@&1418491938704719883>||',
    embeds: [{
      title: `🎉  **הגרלה מספר #${number}**  🎉`,
      description:
        `${fmtIL(startAtISO)}\n` +
        `─────────────────────────────\n` +
        `💰 **סכום זכייה:** ${total} בוטיאלים\n` +
        `─────────────────────────────\n` +
        `🎲 **סיכויי זכייה:**\n` +
        (lines.length ? lines.join("\n") : "_עדיין אין משתתפים נוספים_") +
        `\n─────────────────────────────\n` +
        "🔔 **לקבלת עדכונים על הגרלות עתידיות**\n`/lottery_updates_role`",
      color: 0xFF9900,
      footer: { text: `⏳ מסתיים ב־ ${fmtIL(closeAtISO)}` }
    }]
  };
}

function lotteryWinnerEmbed(number, winnerId, total) {
  return {
    embeds: [{
      title: `**🏆 הזוכה בהגרלה #${number} הוא: **`,
      description:
        `─────────────────────\n <@${winnerId}> 🎉\n` +
        `─────────────────────\n**💰 פרס:** ${total} בוטיאלים`,
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
    const guildId  = body.guild_id;
    const channel  = body.channel_id;

    // ⭐️ כפתור רול (כללי): custom_id = "role:<ROLE_ID>"
    if (cid.startsWith("role:")) {
      const roleId = cid.split(":")[1];
      if (!roleId) return json({ type: 4, data: { flags: 64, content: "❌ שגיאת רול." } });

      // הגבלות לפי ערוץ/הודעה (אופציונלי)
      if (ROLE_BUTTON_ENFORCE_CHANNEL && channel !== ROLE_BUTTON_ENFORCE_CHANNEL) {
        return json({ type: 4, data: { flags: 64, content: "❌ לא ניתן להשתמש בכפתור הזה כאן." } });
      }
      if (ROLE_BUTTON_ENFORCE_MESSAGE && body.message?.id !== ROLE_BUTTON_ENFORCE_MESSAGE) {
        return json({ type: 4, data: { flags: 64, content: "❌ לא ניתן להשתמש בכפתור הזה בהודעה הזו." } });
      }

      // אם כבר יש למשתמש את הרול — נחזיר הודעה קצרה
      const hasRole = (body.member?.roles || []).includes(roleId);
      if (hasRole) {
        return json({ type: 4, data: { flags: 64, content: `✅ כבר יש לך את הרול.` } });
      }

      try {
        await addRoleToMember(guildId, userId, roleId);
        return json({ type: 4, data: { flags: 64, content: `✅ הרול נוסף בהצלחה!` } });
      } catch (e) {
        console.log("addRole error:", e?.message || e);
        return json({ type: 4, data: { flags: 64, content: `⚠️ לא ניתן להוסיף את הרול כרגע.` } });
      }
    }

// ===== ROULETTE buttons =====
// custom_id: "roulette:ownerId:bet:round:action"
if (cid.startsWith("roulette:")) {
  const [, ownerId, betStr, roundStr, action] = cid.split(":");
  const bet   = parseInt(betStr, 10);
  const round = parseInt(roundStr, 10);

  if (userId !== ownerId) {
    return json({ type: 4, data: { flags: 64, content: `❌ רק מי שהתחיל את הרולטה יכול ללחוץ.` } });
  }

  if (action === "hit") {
    const nextRound = round + 1;
    const bust = Math.random() < rouletteBustChance(nextRound); // ⚠️ סיכוי לפי הסיבוב הבא
    if (bust) {
      return json({
        type: 7,
        data: { content: `🎰 **BUST!** הפסדת (${bet}).`, components: [] }
      });
    }

    const payout = Math.floor(bet * rouletteCompoundedMultiplier(nextRound));
    const nextBustPct = Math.round(rouletteBustChance(nextRound + 1) * 100);
    return json({
      type: 7,
      data: {
        content: `🎰 רולטה — סיבוב ${nextRound} · סכום נוכחי: **${payout}** (סיכוי פיצוץ הבא: ${nextBustPct}%)`,
        components: [
          row([
            btn(`roulette:${ownerId}:${bet}:${nextRound}:hit`,  "המשך", 3),
            btn(`roulette:${ownerId}:${bet}:${nextRound}:cash`, "צא",    4),
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


    // ===== FIGHT buttons =====
    if (cid.startsWith("fight_join:")) {
      const [, creatorId, amountStr] = cid.split(":");
      const amount = parseInt(amountStr, 10);

      if (userId === creatorId) {
        return json({ type: 4, data: { flags: 64, content: `❌ לא ניתן להצטרף לקרב של עצמך.` } });
      }

      const a = await getUser(creatorId);
      const b = await getUser(userId);
      if ((a.balance ?? 100) < amount) {
        return json({ type: 4, data: { flags: 64, content: `❌ <@${creatorId}> אין מספיק בוטיאלים כדי לקיים את הקרב כרגע.` } });
      }
      if ((b.balance ?? 100) < amount) {
        return json({ type: 4, data: { flags: 64, content: `❌ אין לך מספיק בוטיאלים להצטרפות (נדרש ${amount}).` } });
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
            `🏆 הזוכה: <@${winner}> וקיבל **${prize}** בוטיאלים.`,
          components: []
        }
      });
    }

    if (cid.startsWith("fight_cancel:")) {
      const [, creatorId, amountStr] = cid.split(":");
      const amount = parseInt(amountStr, 10);

      if (userId !== creatorId) {
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
        /* ----- lottery_updates_role ----- */
  /* ----- wordle [word?] ----- */
if (cmd === "wordle") {
  await deferPublicInteraction(body);

  try {
    const todayYMD = ymdInTZ();
    const todayHeb = ddmmyyyyInTZ();
    const guessRaw = (opts.word || "").toLowerCase().trim();

    let game = await getOrCreateWordleGame(userId, todayYMD);

    // ללא פרמטר — מצב יומי
// ללא פרמטר — מצב יומי
// ללא פרמטר — מצב יומי
if (!guessRaw) {
  const finished = !!game.finished;
  const history = formatHistoryLines(game.guesses || []);
  const grayLine = summarizeLetters(game.guesses || []);

  let description = history || "_עוד אין ניחושים היום_";
  if (!finished && grayLine) description += `\n\n${grayLine}`;
  if (finished) description += `\n\n🏆 סיימת את הוורדל להיום!\nהמילה: **${game.solution.toUpperCase()}**`;

  await editOriginal(body, wordleEmbed(todayHeb, description));
  return { statusCode: 200, body: "" };
}




    // גמרת את הניסיונות/סימנת סיום
    if (game.finished || (game.attempts || 0) >= WORDLE_MAX_ATTEMPTS) {
await editOriginal(body, wordleEmbed(
  todayHeb,
  `❌ סיימת להיום. המילה היתה: **${game.solution.toUpperCase()}**.\nתחכה עד חצות לפי שעון ישראל למשחק חדש.`
));

      return { statusCode: 200, body: "" };
    }

    // בדיקת ולידציה בסיסית — 5 אותיות באנגלית
    if (!isValidGuess(guessRaw)) {
await editOriginal(body, wordleEmbed(todayHeb, "❌ מילה לא חוקית. חייב 5 אותיות באנגלית."));
      return { statusCode: 200, body: "" };
    }

const { emoji, marks } = scoreWordle(game.solution, guessRaw);
    const attempts = (game.attempts || 0) + 1;

// ניצחון
if (guessRaw === game.solution.toLowerCase()) {
  const newHistory = [...(game.guesses || []), { word: guessRaw, emoji, marks }];

  // נסמן סיום רק אם עוד לא סומן (הגנה ממרוצים)
  const { data: updatedRows, error: finishErr } = await SUPABASE.from("wordle_games")
.update({
  attempts, finished: true, guesses: newHistory,
  updated_at: ymdhmsInTZ()
})
    .eq("user_id", userId)
    .eq("date", todayYMD)
    .is("finished", false)
    .select("id");

  // אם לא עודכנה שורה (כבר סומן כסיום), נטען מחדש את המשחק ונציג בלי פרס
   let awarded = false;
  let contentSuffix = "";

  if (!finishErr && updatedRows && updatedRows.length > 0) {
    // מעניקים פרס על ניצחון: הגבוה מבין 150 או 30% מהיתרה הנוכחית
    const u = await getUser(userId);
    const before = u.balance ?? 100;
    const reward = Math.max(100, Math.floor(before * 0.20));
    const newBal = before + reward;
    await setUser(userId, { balance: newBal });
    awarded = true;
    contentSuffix =
      `\n💰 קיבלת **+${reward}** בוטיאלים על הניצחון!` +
      ` יתרה חדשה: **${newBal}**`;
  }


const history = formatHistoryLines(newHistory);
let description =
  `${history}\n\n` +
  `🏆 סיימת את הוורדל להיום!\n` +
  `המילה: **${game.solution.toUpperCase()}**.` +
  (contentSuffix || ""); // יוסיף שורת פרס אם חולק

await editOriginal(body, wordleEmbed(todayHeb, description));


  return { statusCode: 200, body: "" };
}


// לא ניצחת — עדכון היסטוריה והמשך
const newHistory = [...(game.guesses || []), { word: guessRaw, emoji, marks }];
await SUPABASE.from("wordle_games")
  .update({ attempts, guesses: newHistory, updated_at: ymdhmsInTZ() })
  .eq("user_id", userId)
  .eq("date", todayYMD);


if (attempts >= WORDLE_MAX_ATTEMPTS) {
  // הפסד — מציגים את המילה
  const history = formatHistoryLines(newHistory);
  await editOriginal(body, wordleEmbed(
    todayHeb,
    `${history}\n\n❌ זה היה הניסיון השישי. המילה הנכונה: **${game.solution.toUpperCase()}**.`
  ));
} else {
  // יש עוד ניסיונות — מציגים היסטוריה + רק אותיות אפורות + “נסה שוב”
  const left = WORDLE_MAX_ATTEMPTS - attempts;
  const history = formatHistoryLines(newHistory);
  const grayLine2 = summarizeLetters(newHistory);

  let description = history;
  if (grayLine2) description += `\n\n${grayLine2}`;
  description += `\nנסה שוב. נשארו **${left}** ניסיונות.`;

  await editOriginal(body, wordleEmbed(todayHeb, description));
}



    return { statusCode: 200, body: "" };
  } catch (e) {
  console.log("wordle error:", e?.message || e);
  const todayHeb = ddmmyyyyInTZ(); // כדי שיהיה כותרת עם התאריך גם בשגיאה
  await editOriginal(body, wordleEmbed(todayHeb, "⚠️ תקלה זמנית. נסה שוב מאוחר יותר."));
  return { statusCode: 200, body: "" };
}
}

/* ----- lottery_updates_role ----- */
/* ----- lottery_updates_role ----- */
if (cmd === "lottery_updates_role") {
  await deferPublicInteraction(body); // אם תרצה אפמרלי: החלף ל-deferEphemeralInteraction

  const guildId = body.guild_id;
  if (!guildId) {
    await editOriginal(body, { content: "❌ הפקודה זמינה רק בשרת." });
    return { statusCode: 200, body: "" };
  }

  const already = (body.member?.roles || []).includes(UPDATES_ROLE_ID);

  try {
    if (already) {
      // אם יש למשתמש את הרול – נוריד
      const r = await fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${UPDATES_ROLE_ID}`, {
        method: "DELETE",
        headers: BOT_HEADERS,
      });
      if (!r.ok) throw new Error(`removeRole ${r.status}: ${await r.text()}`);

      await editOriginal(body, { content: "❌ הסרתי לך את רול העדכונים" });
      return { statusCode: 200, body: "" };
    } else {
      // אם אין – נוסיף
      await addRoleToMember(guildId, userId, UPDATES_ROLE_ID);

      await editOriginal(body, { content: "✅ קיבלת את רול העדכונים 📢" });
      return { statusCode: 200, body: "" };
    }
  } catch (e) {
    console.log("updates_role error:", e?.message || e);
    await editOriginal(body, {
      content: "⚠️ לא הצלחתי לשנות את הרול. ודא שלבוט יש Manage Roles והרול מתחת לרול של הבוט."
    });
    return { statusCode: 200, body: "" };
  }
}


if (cmd === "balance") {
  await deferPublicInteraction(body); // או public
  const u = await getUser(userId);
  await editOriginal(body, { content: `💰 ${username}, היתרה שלך: **${u.balance}** בוטיאלים` });
  return { statusCode: 200, body: "" };
}

    /* ----- work (+10 / 1h) ----- */
/* ----- work (max of +10 or 2%) ----- */
if (cmd === "work") {
  await deferPublicInteraction(body);

  try {
    
    const now = Date.now();
    const u = await getUser(userId);
// קריאת last_work — כולל תיקון לערכים היסטוריים שנשמרו ללא טיימזון (IL)
// ערכים כאלה נפרסים כ-UTC ולכן יוצאים בעתיד (2–3 שעות)
let last = u.last_work ? new Date(u.last_work).getTime() : 0;

if (
  last > now + 5 * 60 * 1000 &&                         // נראה "בעתיד"
  typeof u.last_work === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(u.last_work) // בלי Z/offset
) {
  // ננסה להפחית 2 שעות (חורף); אם עדיין בעתיד — נפחית 3 (קיץ/DST)
  const minus2 = last - 2 * 60 * 60 * 1000;
  const minus3 = last - 3 * 60 * 60 * 1000;
  last = minus2 <= now ? minus2 : minus3;

  // ננרמל במסד לפורמט ISO עם Z כדי שהבאג לא יחזור
  await setUser(userId, { last_work: new Date(last).toISOString() });
}

    if (now - last < HOUR) {
      const left = HOUR - (now - last);
      const m = Math.floor(left / (60 * 1000));
      const s = Math.floor((left % (60 * 1000)) / 1000);
      await editOriginal(body, { content: `⏳ עבדת לא מזמן. נסה שוב בעוד ${m} דק׳ ו־${s} שניות.` });
      return { statusCode: 200, body: "" };
    }

    const before = u.balance ?? 100;
    const reward = Math.max(10, Math.floor(before * 0.02));
    const balance = before + reward;

await setUser(userId, { balance, last_work: new Date(now).toISOString() });
    await editOriginal(body, { content: `👷 קיבלת **${reward}** בוטיאלים על עבודה. יתרה: **${balance}**` });
    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("work error:", e);
    await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
    return { statusCode: 200, body: "" };
  }
}


    /* ----- coinflip choice amount ----- */
if (cmd === "coinflip") {
  await deferPublicInteraction(body);

  try {
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
    if (amount > (u.balance ?? 100)) {
      await editOriginal(body, { content: `❌ אין לך מספיק בוטיאלים. היתרה: ${u.balance ?? 100}.` });
      return { statusCode: 200, body: "" };
    }

// קובעים מראש האם המשתמש ניצח בהטלה הזו (55%)
const won = Math.random() < COIN_USER_WIN_P;
// מייצרים "תוצאת מטבע" עקבית עם התוצאה
const flip = won ? choice : (choice === "heads" ? "tails" : "heads");

const balance = (u.balance ?? 100) + (won ? amount : -amount);

await setUser(userId, { balance });
await editOriginal(body, {
  content: `🪙 יצא **${flip}** — ${won ? `זכית! +${amount}` : `הפסדת... -${amount}`} | יתרה: **${balance}**`
});

    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("coinflip error:", e);
    await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
    return { statusCode: 200, body: "" };
  }
}


    /* ----- daily (+50 / 24h) ----- */
   /* ----- daily (+50 / 24h) ----- */
/* ----- daily (max of +50 or 10%) / 24h ----- */
if (cmd === "daily") {
  await deferPublicInteraction(body);

  try {
    const now = Date.now();
    const today = ymdInTZ(now, WORDLE_TZ); // YYYY-MM-DD לפי שעון ישראל
    const u = await getUser(userId);

    // נחלץ YMD של הפעם הקודמת (תומך גם בתאריך-טקסט וגם ב-ISO/timestamp)
    let lastYMD = null;
    if (u.last_daily) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(u.last_daily)) {
        // נשמר כתאריך-טקסט (YYYY-MM-DD)
        lastYMD = u.last_daily;
      } else {
        // נשמר בעבר כ-timestamp/ISO — נמיר ל-YMD לפי ישראל
        const t = new Date(u.last_daily).getTime();
        if (!Number.isNaN(t)) lastYMD = ymdInTZ(t, WORDLE_TZ);
      }
    }

    // אם כבר נאסף היום — נחסום
    if (lastYMD === today) {
      await editOriginal(body, { content: `⏳ כבר לקחת היום. תחזור מחר.` });
      return { statusCode: 200, body: "" };
    }

    // תגמול: הגבוה מבין 50 או 10% מהיתרה
    const before = u.balance ?? 100;
    const reward = Math.max(50, Math.floor(before * 0.10));
    const balance = before + reward;

    // נשמור timestamp (וגם אם העמודה היא טקסט/טיימסטמפ זה יעבוד; ההשוואה תמיד נעשית לפי YMD)
// היה: await setUser(userId, { balance, last_daily: new Date(now).toISOString() });
await setUser(userId, { balance, last_daily: ymdInTZ(now, WORDLE_TZ) }); // למשל "2025-02-03"

    await editOriginal(body, { content: `🎁 קיבלת **${reward}** בוטיאלים! יתרה חדשה: **${balance}**` });
    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("daily error:", e);
    await editOriginal(body, { content: "⚠️ תקלה זמנית. נסה שוב מאוחר יותר." });
    return { statusCode: 200, body: "" };
  }
}


    /* ----- dice amount (d6 vs bot) ----- */
/* ----- dice amount (d6 vs bot) ----- */
if (cmd === "dice") {
  await deferPublicInteraction(body);

  try {
    const amount = parseInt(opts.amount, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
      return { statusCode: 200, body: "" };
    }

    // נוודא למשתמש רשומה ונביא יתרה
    const u0 = await getUser(userId);
    let balance = u0?.balance ?? 100;

    if (balance < amount) {
      await editOriginal(body, { content: `${username}, אין לך מספיק בוטיאלים 🎲 (יתרה: ${balance})` });
      return { statusCode: 200, body: "" };
    }


let userRoll, botRoll;
const r = Math.random();

if (r < DICE_USER_WIN_P) {
  // ניצחון למשתמש: בוחרים זוג עם user > bot
  // בוחרים bot 1..5 ואז user בטווח (bot+1..6)
  botRoll  = 1 + Math.floor(Math.random() * 5);
  userRoll = botRoll + 1 + Math.floor(Math.random() * (6 - botRoll));
} else if (r < DICE_USER_WIN_P + DICE_TIE_P) {
  // תיקו: אותו מספר
  userRoll = botRoll = 1 + Math.floor(Math.random() * 6);
} else {
  // הפסד למשתמש: user < bot
  userRoll = 1 + Math.floor(Math.random() * 5);
  botRoll  = userRoll + 1 + Math.floor(Math.random() * (6 - userRoll));
}

    if (userRoll > botRoll) {
      balance += amount;
      await setUser(userId, { balance });
      await editOriginal(body, { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — ניצחת! +${amount}. יתרה: **${balance}**` });
    } else if (userRoll < botRoll) {
      balance -= amount;
      await setUser(userId, { balance });
      await editOriginal(body, { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — עוד ניצחון לאלי -${amount}. יתרה: **${balance}**` });
    } else {
      await editOriginal(body, { content: `🎲 תיקו! אתה: **${userRoll}**, אלי: **${botRoll}** — אין שינוי (יתרה: ${balance})` });
    }

    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("dice error:", e);
    await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
    return { statusCode: 200, body: "" };
  }
}


 /* ----- give user amount ----- */
if (cmd === "give") {
  await deferPublicInteraction(body);

  try {
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
    const giverBal = u.balance ?? 100;
    if (giverBal < amount) {
      await editOriginal(body, { content: `❌ אין לך מספיק בוטיאלים. היתרה: ${giverBal}.` });
      return { statusCode: 200, body: "" };
    }

    const receiver = await getUser(target);
    const receiverBal = receiver.balance ?? 100;

    // עדכון יתרות
    await setUser(userId, { balance: giverBal - amount });
    await setUser(target,  { balance: receiverBal + amount });

    await editOriginal(body, {
      content: `🤝 העברת **${amount}** ל־<@${target}>. היתרה שלך: **${giverBal - amount}**, שלו: **${receiverBal + amount}**`
    });
    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("give error:", e);
    await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
    return { statusCode: 200, body: "" };
  }
}

    /* ----- top ----- */
if (cmd === "top") {
  await deferPublicInteraction(body); // מציג "Thinking..." ציבורי

  try {
    const { data } = await SUPABASE
      .from("users")
      .select("id, balance")
      .order("balance", { ascending: false })
      .limit(10);

    if (!data || data.length === 0) {
      await editOriginal(body, { content: `אין עדיין נתונים ללוח הובלות.` });
      return { statusCode: 200, body: "" };
    }

    const lines = data.map((u, i) => `**${i + 1}.** <@${u.id}> — ${u.balance} ${eliCoin}`);

    await editOriginal(body, {
      embeds: [
        {
          title: "🏆 טופ 10 עשירים",
          description: lines.join("\n"),
          color: 0xf1c40f
        }
      ]
    });

    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("top error:", e?.message || e);
    await editOriginal(body, { content: "⚠️ תקלה זמנית. נסה שוב מאוחר יותר." });
    return { statusCode: 200, body: "" };
  }
}



   /* ----- roulette amount ----- */
if (cmd === "roulette") {
  await deferPublicInteraction(body);

  const amount = parseInt(opts.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
    return { statusCode: 200, body: "" };
  }

  const u = await getUser(userId);
  if ((u.balance ?? 100) < amount) {
    await editOriginal(body, { content: `❌ אין לך מספיק בוטיאלים. היתרה: ${u.balance ?? 100}.` });
    return { statusCode: 200, body: "" };
  }

  // מחייבים את המשתמש על ההימור
  await setUser(userId, { balance: (u.balance ?? 100) - amount });

  // 🔥 בדיקת BUST לסיבוב 1 (5%)
  const immediateBust = Math.random() < rouletteBustChance(1);
  if (immediateBust) {
    await editOriginal(body, {
      content: `🎰 **BUST!** הפסדת (${amount}).`,
      components: [] // נטרל כפתורים אם היו
    });
    return { statusCode: 200, body: "" };
  }

  // אם שרדנו את סיבוב 1 – מציגים Round 1 עם מכפיל 1.1
  const round = 1;
  const payout = Math.floor(amount * rouletteCompoundedMultiplier(round));
  const nextBustPct = Math.round(rouletteBustChance(round + 1) * 100);

  await editOriginal(body, {
    content: `🎰 רולטה — סיבוב ${round} · סכום נוכחי: **${payout}** (סיכוי פיצוץ הבא: ${nextBustPct}%)`,
    components: [
      row([
        btn(`roulette:${userId}:${amount}:${round}:hit`,  "המשך", 3),
        btn(`roulette:${userId}:${amount}:${round}:cash`, "צא",    4),
      ])
    ]
  });
  return { statusCode: 200, body: "" };
}


    /* ----- fight amount ----- */
   /* ----- fight amount ----- */
if (cmd === "fight") {
  await deferPublicInteraction(body); // שולח ACK ציבורי ("thinking...")

  const amount = parseInt(opts.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    await editOriginal(body, { content: "❌ סכום לא תקין." });
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


    /* ----- LOTTERY ----- */
    if (cmd === "lottery") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        // שגיאה מיד — אפמרלי קצר, בלי defer
        return json({ type: 4, data: { flags: 64, content: "❌ סכום לא תקין." } });
      }

await deferPublicInteraction(body);
// לא מוחקים יותר את ההודעה


      try {
        // 1) אם יש הגרלה פתוחה שפג זמנה — נסגור, נכריז זוכה בהודעה נפרדת, ונסמן סגורה
        const { data: open } = await SUPABASE
          .from("lotteries")
          .select("id,status,is_open,close_at,message_id,number,channel_id")
          .eq("status","open")
          .eq("is_open", true)
          .maybeSingle();

        if (open && open.close_at && Date.now() > new Date(open.close_at).getTime()) {
          const { data: rows } = await SUPABASE
            .from("lottery_entries")
            .select("user_id,amount")
            .eq("lottery_id", open.id);

          const totalPast = (rows || []).reduce((s, r) => s + r.amount, 0);

          if (totalPast > 0 && rows?.length) {
            let roll = Math.random() * totalPast;
            let winner = rows[0].user_id;
            for (const r of rows) { roll -= r.amount; if (roll <= 0) { winner = r.user_id; break; } }

            const w = await getUser(winner);
            await setUser(winner, { balance: (w.balance ?? 100) + totalPast });

            // הכרזה חדשה ונפרדת (לא עורכים את הודעת הלוטו המקורית)
            await postChannelMessage(open.channel_id || LOTTERY_CHANNEL_ID, {
              content: `<@${winner}>`,
              ...lotteryWinnerEmbed(open.number, winner, totalPast)
            });
          }
          await SUPABASE.from("lotteries").update({
            status: "closed",
            is_open: false,
closed_at: ymdhmsInTZ()
          }).eq("id", open.id);
        }

        // 2) בדיקת יתרה
        const u = await getUser(userId);
        if ((u.balance ?? 100) < amount) {
await editOriginal(body, { content: `❌ אין לך מספיק בוטיאלים (יתרה: ${u.balance}).` });
return { statusCode: 200, body: "" };

        }

        // 3) לוקחים/פותחים הגרלה פתוחה
        let { data: lot } = await SUPABASE
          .from("lotteries")
          .select("id,status,is_open,message_id,close_at,created_at,number,channel_id")
          .eq("status","open")
          .eq("is_open", true)
          .maybeSingle();

        let createdNew = false;

        if (lot) {
          // ודא ש-close_at = created_at + 24h
const targetClose = ymdhmsInTZ(new Date(lot.created_at).getTime() + 24*60*60*1000, WORDLE_TZ);
          if (!lot.close_at || Math.abs(new Date(lot.close_at).getTime() - new Date(targetClose).getTime()) > 2000) {
            await SUPABASE.from("lotteries").update({ close_at: targetClose }).eq("id", lot.id);
            lot.close_at = targetClose;
          }
        } else {
          // אין הגרלה פתוחה — יוצרים חדשה בהתאם לסכימה עם NOT NULL
          const nowMs = Date.now();
const createdAtIL = ymdhmsInTZ(nowMs, WORDLE_TZ);
const closeAtIL   = ymdhmsInTZ(nowMs + 24*60*60*1000, WORDLE_TZ);


          // מספר רץ
          const { data: lastNumRow } = await SUPABASE
            .from("lotteries")
            .select("number")
            .order("number", { ascending: false })
            .limit(1)
            .maybeSingle();
          const nextNumber = ((lastNumRow?.number) || 0) + 1;

          const newId = randomUUID();
          const insertRow = {
            id: newId,
            channel_id: LOTTERY_CHANNEL_ID,
created_at: createdAtIL,
            closed_at: null,
close_at: closeAtIL,
            total: 0,
            status: "open",
            number: nextNumber,
            is_open: true,
            message_id: null
          };

          const { data: newLot, error: insErr } = await SUPABASE
            .from("lotteries")
            .insert(insertRow)
            .select()
            .single();
          if (insErr) {
            console.log("lottery insert error:", insErr);
            await postChannelMessage(channelId, { content: `<@${userId}> ⚠️ תקלה ביצירת הגרלה חדשה.` });
            return { statusCode: 200, body: "" };
          }
          lot = newLot;
          createdNew = true;
        }

        // 4) האם זה המשתתף/הראשון לפני ההוספה
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
          await SUPABASE.from("lottery_entries")
            .update({ amount: existing.amount + amount })
            .eq("id", existing.id);
        } else {
          await SUPABASE.from("lottery_entries")
            .insert({ id: randomUUID(), lottery_id: lot.id, user_id: userId, amount, inserted_at: ymdhmsInTZ() });
        }

        // 7) עדכון הודעת הלוטו בערוץ הייעודי
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

        const confirmText = wasFirst
  ? `<@${userId}> פתח את הגרלה מספר #${lot.number} עם סכום של **${amount}** בוטיאלים 💰`
  : `<@${userId}> הוסיף **${amount}** בוטיאלים להגרלה 💰`;

await editOriginal(body, { content: confirmText });


        // 8) אישור פומבי/פרטי לפי מה שכבר עובד אצלך (כרגע לא שולחים הודעה נוספת כאן)
        // אם תרצה - כאן אפשר לעשות editOriginal(...) עם אישור, אבל לא משנים טקסטים קיימים.

        return { statusCode: 200, body: "" };
      } catch (e) {
        console.log("lottery error:", e?.message || e);
        await editOriginal(body, { content: `⚠️ תקלה זמנית בעיבוד ההגרלה. נסה/י שוב.` });
return { statusCode: 200, body: "" };

      }
    }

    // לא מוכר
    return json({ type: 4, data: { content: `הפקודה לא מוכרת.` } });
  } // ← if (body?.type === 2)

  // אחרת (לא כפתור/לא פקודה/כל מקרה לא מזוהה) – החזר ACK ריק
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: 5 })
  };
}











































