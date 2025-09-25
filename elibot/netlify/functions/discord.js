// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";
import { randomUUID } from "crypto";

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
// ===== WORDLE (words + helpers) =====
// רשימת מילים של 5 אותיות (שים פה כמה שיותר. דוגמה חלקית)
const WORDLE_WORDS = [
  "about","other","which","their","there","first","would","these","could","sound",
  "after","thing","where","right","think","three","small","large","house","place",
  "again","point","group","under","water","often","young","story","while","light",
  "world","music","apple","share","times","great","plant","build","stand","learn",
  "power","heart","north","south","black","white","green","brown","short","long",
  "table","chair","glass","stone","paper","phone","cloud","sweet","salty","spice",
  "truck","train","beach","river","mount","money","happy","sadly","angry","proud",
  "sleep","dream","smile","laugh","drink","bread","cheese","pasta","pizza","sauce",
  "quiet","noisy","early","later","start","final","human","robot","candy","honey",
  "metal","solid","fluid","vapor","laser","gamma","radio","micro","macro","quant",
  "delta","sigma","theta","omega","eagle","tiger","zebra","koala","panda","camel",
  "crown","sword","guard","magic","fairy","giant","ghost","witch","flame","frost"
];
// אם יש לך רשימה ארוכה אמיתית – פשוט תדביק אותה במקום המערך הזה.
const WORDLE_VALID = new Set(WORDLE_WORDS); // בדיקת חוקיות ניחוש

// תאריך היום ב־Asia/Jerusalem בפורמט YYYY-MM-DD
function ilTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

// בחר מילה חדשה רנדומלית
function pickRandomWord() {
  return WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];
}

// פידבק כמו וורדל, כולל טיפול בכפילויות
function evaluateGuess(guess, solution) {
  const n = solution.length;
  const fb = Array(n).fill('⬜');
  const counts = {};
  for (let i = 0; i < n; i++) counts[solution[i]] = (counts[solution[i]] || 0) + 1;
  for (let i = 0; i < n; i++) if (guess[i] === solution[i]) { fb[i] = '🟩'; counts[guess[i]]--; }
  for (let i = 0; i < n; i++) {
    if (fb[i] === '🟩') continue;
    const c = guess[i];
    if ((counts[c] || 0) > 0) { fb[i] = '🟨'; counts[c]--; }
  }
  return fb.join('');
}

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
  const row = {
    id: userId,
    balance: 100,
    last_daily: null,
    last_work: null,
    // ↓↓↓ חדשים לוורדל
    wordle_word: null,
    wordle_date: null,
    wordle_tries: 0
  };
  await SUPABASE.from("users").insert(row);
  return row;
}

  async function ensureWordleForToday(userId) {
  const today = ilTodayISO();                 // YYYY-MM-DD לפי שעון ישראל
  const u = await getUser(userId);
  if (u.wordle_date !== today || !u.wordle_word) {
    const word = pickRandomWord();
    await setUser(userId, { wordle_word: word, wordle_date: today, wordle_tries: 0 });
    return { word, tries: 0, date: today };
  }
  return { word: u.wordle_word, tries: u.wordle_tries || 0, date: u.wordle_date };
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

// סיכון התחלתי 20% + עולה ב־1% לכל סיבוב
const ROULETTE_BASE_BUST = 0.20; // 20% בסיבוב 1
const ROULETTE_STEP_BUST = 0.01; // +1% לכל סיבוב
const rouletteBustChance = (round) =>
  Math.min(ROULETTE_BASE_BUST + (round - 1) * ROULETTE_STEP_BUST, 1);




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
    timeZone: "Asia/Jerusalem",
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
        `💰 **סכום זכייה:** ${total} מטבעות\n` +
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

    /* ----- WORDLE: פקודה אחת ----- */
// /wordle [word?: string]
if (cmd === "wordle") {
  await deferPublicInteraction(body);

  const guessRaw = (opts.word ?? "").toString().trim().toLowerCase();

  // מאבטחים שיש מילה ליום (ואיפוס ניסיונות אם עבר יום)
  const { word, tries, date } = await ensureWordleForToday(userId);

  // אם לא סופק ניחוש — מציג סטטוס
  if (!guessRaw) {
    const triesLeft = Math.max(0, 6 - (tries || 0));
    await editOriginal(body, {
      embeds: [{
        title: "🧠 WORDLE יומי (פר־משתמש)",
        description:
          `תאריך: **${date}** (Asia/Jerusalem)\n` +
          `מילה של 5 אותיות באנגלית.\n` +
          `נשארו לך **${triesLeft}** ניסיונות להיום.\n\n` +
          `נחש עם: \`/wordle word:<xxxxx>\``,
        color: 0x00b894
      }]
    });
    return { statusCode: 200, body: "" };
  }

  // יש ניחוש — בודקים חוקיות
  if (guessRaw.length !== 5 || !WORDLE_VALID.has(guessRaw)) {
    await editOriginal(body, { content: "❌ מילה לא חוקית. צריך 5 אותיות מהרשימה." });
    return { statusCode: 200, body: "" };
  }

  // נגמרו ניסיונות?
  if ((tries || 0) >= 6) {
    await editOriginal(body, { content: `💥 נגמרו לך הניסיונות להיום (${date}). נסה מחר.` });
    return { statusCode: 200, body: "" };
  }

  // מחשבים פידבק
  const feedback = evaluateGuess(guessRaw, word);
  const won = feedback === "🟩🟩🟩🟩🟩";
  const nextTries = (tries || 0) + 1;

  await setUser(userId, { wordle_tries: nextTries });

  if (won) {
    await editOriginal(body, {
      embeds: [{
        title: "🏆 WORDLE — ניצחון!",
        description: `פתרת ב־**${nextTries}** ניחושים.\n${feedback}\n\nתבוא מחר לעוד סיבוב 😉`,
        color: 0x2ecc71,
        footer: { text: `תאריך: ${date}` }
      }]
    });
    return { statusCode: 200, body: "" };
  }

  if (nextTries >= 6) {
    await editOriginal(body, {
      embeds: [{
        title: "💥 WORDLE — נגמרו הניסיונות",
        description: `${feedback}\n\nהפתרון היה: **${word}**\nנסה שוב מחר.`,
        color: 0xe74c3c,
        footer: { text: `תאריך: ${date}` }
      }]
    });
    return { statusCode: 200, body: "" };
  }

  // עוד יש ניסיונות
  const left = 6 - nextTries;
  await editOriginal(body, {
    embeds: [{
      title: "🧠 WORDLE",
      description: `${feedback}\nנשארו לך **${left}** ניסיונות.`,
      color: 0x00b894,
      footer: { text: `תאריך: ${date}` }
    }]
  });
  return { statusCode: 200, body: "" };
}


if (cmd === "balance") {
  await deferPublicInteraction(body); // או public
  const u = await getUser(userId);
  await editOriginal(body, { content: `💰 ${username}, היתרה שלך: **${u.balance}** מטבעות` });
  return { statusCode: 200, body: "" };
}

    /* ----- work (+10 / 1h) ----- */
if (cmd === "work") {
  await deferPublicInteraction(body);

  try {
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
      await editOriginal(body, { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance ?? 100}.` });
      return { statusCode: 200, body: "" };
    }

    const flip = Math.random() < 0.5 ? "heads" : "tails";
    const won  = (flip === choice);
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
if (cmd === "daily") {
  // שולח "Thinking..." אפמרלי. אם אתה רוצה פומבי: החלף ל-deferPublicInteraction
  await deferPublicInteraction(body);

  try {
    const now = Date.now();
    const u = await getUser(userId);
    const last = u.last_daily ? new Date(u.last_daily).getTime() : 0;

    // בקירור
    if (now - last < DAY) {
      const left = DAY - (now - last);
      const h = Math.floor(left / HOUR);
      const m = Math.floor((left % HOUR) / (60 * 1000));
      await editOriginal(body, { content: `⏳ כבר לקחת היום. נסה שוב בעוד ${h} שעות ו־${m} דקות.` });
      return { statusCode: 200, body: "" }; // ← תמיד לסיים כך אחרי defer
    }

    // מעניקים
    const balance = (u.balance ?? 100) + 50;
    await setUser(userId, { balance, last_daily: new Date(now).toISOString() });

    await editOriginal(body, { content: `🎁 קיבלת **50** מטבעות! יתרה חדשה: **${balance}**` });
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
      await editOriginal(body, { content: `${username}, אין לך מספיק מטבעות 🎲 (יתרה: ${balance})` });
      return { statusCode: 200, body: "" };
    }

    const userRoll = Math.floor(Math.random() * 6) + 1;
    const botRoll  = Math.floor(Math.random() * 6) + 1;

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
      await editOriginal(body, { content: `❌ אין לך מספיק מטבעות. היתרה: ${giverBal}.` });
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
  const { data } = await SUPABASE
    .from("users")
    .select("id, balance")
    .order("balance", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) {
    return json({
      type: 4,
      data: {
        content: `אין עדיין נתונים ללוח הובלות.`
      }
    });
  }

  const lines = data.map((u, i) => `**${i + 1}.** <@${u.id}> — ${u.balance} 🪙`);

  return json({
    type: 4,
    data: {
      embeds: [
        {
          title: "🏆 טופ 10 עשירים",
          description: lines.join("\n"),
          color: 0xf1c40f // צבע זהב
        }
      ]
    }
  });
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
    await editOriginal(body, { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance ?? 100}.` });
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
            closed_at: new Date().toISOString()
          }).eq("id", open.id);
        }

        // 2) בדיקת יתרה
        const u = await getUser(userId);
        if ((u.balance ?? 100) < amount) {
await editOriginal(body, { content: `❌ אין לך מספיק מטבעות (יתרה: ${u.balance}).` });
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
          const targetClose = new Date(new Date(lot.created_at).getTime() + 24*60*60*1000).toISOString();
          if (!lot.close_at || Math.abs(new Date(lot.close_at).getTime() - new Date(targetClose).getTime()) > 2000) {
            await SUPABASE.from("lotteries").update({ close_at: targetClose }).eq("id", lot.id);
            lot.close_at = targetClose;
          }
        } else {
          // אין הגרלה פתוחה — יוצרים חדשה בהתאם לסכימה עם NOT NULL
          const now = new Date();
          const createdAtISO = now.toISOString();
          const closeAtISO   = new Date(now.getTime() + 24*60*60*1000).toISOString();

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
            created_at: createdAtISO,
            closed_at: null,
            close_at: closeAtISO,
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
            .insert({ id: randomUUID(), lottery_id: lot.id, user_id: userId, amount, inserted_at: new Date().toISOString() });
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
  ? `<@${userId}> פתח את הגרלה מספר #${lot.number} עם סכום של **${amount}** מטבעות 💰`
  : `<@${userId}> הוסיף **${amount}** מטבעות להגרלה 💰`;

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

























