import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";
import { randomUUID } from "crypto";
import { handleComponentInteraction } from "./components-handler.js";
import { handleSlashCommand } from "./slash-handler.js";

function buildDiscordHandler({ getWordList }) {
  if (typeof getWordList !== "function") {
    throw new Error("handleDiscordEvent requires getWordList()");
  }
  process.env.TZ = "Asia/Jerusalem";
  const json = (obj, status = 200) => ({
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  
  function readRawBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
  
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
  
  // ממיר ערך של Postgres/טקסט ל-millis מאז epoch (UTC) בצורה בטוחה
  // ----- IL Local time helpers -----
  // מפרש כל מחרוזת זמן כאילו היא שעון ישראל, ומתעלם מאופסט/‏Z אם יש.
  // תומך: "YYYY-MM-DD HH:mm:ss+00" / "+03" / "+0300" / "YYYY-MM-DDTHH:mm:ssZ" / בלי אופסט בכלל.
  function toMsILLocal(v) {
    if (!v) return 0;
    if (typeof v === "number") return v;
  
    let s = String(v).trim();
  
    // החלפת רווח ל-T כדי ש-Date.parse יתייחס מקומית
    s = s.replace(" ", "T");
  
    // זריקת אופסט/‏Z בסוף המחרוזת (אנחנו מתייחסים לערך כקיר-שעון ישראל)
    s = s.replace(/([+-]\d{2}:\d{2}|[+-]\d{2}\d{2}|[+-]\d{2}|Z)$/i, "");
  
    // אם נשארו אלפיות, זה בסדר: "YYYY-MM-DDTHH:mm:ss.sss"
    const t = Date.parse(s); // יפורש "local time" — אצלנו Asia/Jerusalem
    return Number.isFinite(t) ? t : 0;
  }
  
  // זמן נוכחי כמחרוזת ישראלית לשמירה במסד, בלי אופסט/‏Z.
  function nowILString() {
    return ymdhmsInTZ(Date.now(), "Asia/Jerusalem"); // מחזיר "YYYY-MM-DDTHH:mm:ss"
  }
  
  // פורמט יפה להצגה "YYYY-MM-DD HH:mm:ss" לפי ישראל
  function fmtReadyIL(ms) {
    return ymdhmsInTZ(ms, "Asia/Jerusalem").replace("T", " ");
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
  // === Number formatting (עם פסיקים, סגנון 1,000) ===
  const N_EN = new Intl.NumberFormat("en-US");
  const fmtN = (x) => N_EN.format(Math.trunc(Number(x) || 0)); // תמיד שלם, עם פסיקים
  const WORDLE_ANSWERS_URL = "https://gist.githubusercontent.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b/raw/c46f451920d5cf6326d550fb2d6abb1642717852/wordle-answers-alphabetical.txt";
  const WORDLE_ANSWERS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  let cachedWordleAnswers = null;
  let cachedWordleAnswersAt = 0;
  
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

  async function getWordleAnswers() {
    const now = Date.now();
    if (cachedWordleAnswers && (now - cachedWordleAnswersAt) < WORDLE_ANSWERS_CACHE_TTL_MS) {
      return cachedWordleAnswers;
    }

    try {
      const r = await fetch(WORDLE_ANSWERS_URL, { method: "GET" });
      if (!r.ok) throw new Error(`wordle answers fetch ${r.status}`);

      const text = await r.text();
      const list = text
        .split(/\r?\n/)
        .map((w) => String(w).trim().toLowerCase())
        .filter((w) => w.length === 5 && /^[a-z]{5}$/.test(w));

      if (!list.length) throw new Error("wordle answers list empty");

      cachedWordleAnswers = [...new Set(list)];
      cachedWordleAnswersAt = now;
      return cachedWordleAnswers;
    } catch (e) {
      if (cachedWordleAnswers?.length) return cachedWordleAnswers;
      throw e;
    }
  }
  
  async function getOrCreateWordleGame(userId, ymd) {
    const { data } = await SUPABASE
      .from("wordle_games").select("*")
      .eq("user_id", userId).eq("date", ymd).maybeSingle();
  
    if (data) return data;
  
    const answers = await getWordleAnswers();
    if (!answers.length) throw new Error("wordle answers empty");
    const solution = answers[Math.floor(Math.random() * answers.length)];
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
  // 🔹 — אות שעדיין לא נוסתה בכלל
  function summarizeLetters(guesses) {
    const green = new Set();
    const yellow = new Set();
    const gray = new Set();
    const tried = new Set();
  
    for (const g of (guesses || [])) {
      const marks = g.marks && Array.isArray(g.marks) ? g.marks : marksFromEmoji(g.emoji || "⬜⬜⬜⬜⬜");
      const word = (g.word || "").toUpperCase();
      for (let i = 0; i < 5; i++) {
        const ch = word[i];
        if (!ch) continue;
        tried.add(ch);
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

    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const untried = alphabet.filter((ch) => !tried.has(ch));

    const lines = [];
    if (gray.size) {
      const grayList = [...gray].sort((a, b) => a.localeCompare(b)).join(", ");
      lines.push(`⬜: ${grayList}`);
    }
    if (untried.length) {
      lines.push(`🔹: ${untried.join(", ")}`);
    }

    return lines.join("\n");
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
          `💰 **סכום זכייה:** ${fmtN(total)} בוטיאלים\n` +
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
          `─────────────────────\n**💰 פרס:** ${fmtN(total)} בוטיאלים`,
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
  async function netlifyHandler(event) {
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
  
    const componentResponse = await handleComponentInteraction(body, {
      json,
      addRoleToMember,
      ROLE_BUTTON_ENFORCE_CHANNEL,
      ROLE_BUTTON_ENFORCE_MESSAGE,
      rouletteBustChance,
      rouletteCompoundedMultiplier,
      fmtN,
      row,
      btn,
      getUser,
      setUser,
    });
    if (componentResponse) return componentResponse;

    const slashResponse = await handleSlashCommand(body, {
      json,
      ensureUsernameOnce,
      GAMBLING_CMDS,
      ALLOWED_GAMBLING_CHANNEL,
      deferPublicInteraction,
      deferEphemeralInteraction,
      ymdInTZ,
      ddmmyyyyInTZ,
      getWordList,
      getOrCreateWordleGame,
      formatHistoryLines,
      summarizeLetters,
      wordleEmbed,
      editOriginal,
      WORDLE_MAX_ATTEMPTS,
      isValidGuess,
      scoreWordle,
      SUPABASE,
      ymdhmsInTZ,
      getUser,
      setUser,
      fmtN,
      UPDATES_ROLE_ID,
      API,
      BOT_HEADERS,
      addRoleToMember,
      toMsILLocal,
      fmtReadyIL,
      nowILString,
      WORDLE_TZ,
      DICE_USER_WIN_P,
      DICE_TIE_P,
      COIN_USER_WIN_P,
      eliCoin,
      rouletteBustChance,
      rouletteCompoundedMultiplier,
      row,
      btn,
      postChannelMessage,
      lotteryWinnerEmbed,
      LOTTERY_CHANNEL_ID,
      randomUUID,
      editOrPostLotteryMessage,
      lotteryOpenEmbed,
    });
    if (slashResponse) return slashResponse;

    // אחרת (לא כפתור/לא פקודה/כל מקרה לא מזוהה) – החזר ACK ריק
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 5 })
    };
  }
  
  return netlifyHandler;
}

export async function handleDiscordEvent(event, { getWordList }) {
  const handler = buildDiscordHandler({ getWordList });
  return handler(event);
}
