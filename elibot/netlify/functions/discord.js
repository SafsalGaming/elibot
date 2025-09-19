// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
import { fetch } from "undici";

const SUPABASE = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// חדרי יעוד
const ALLOWED_GAMBLING_CHANNEL = "1418196736958005361"; // רולטה ופייט
const LOTTERY_CHANNEL_ID       = "1418491365259477084"; // הודעת הלוטו מתפרסמת ומתעדכנת כאן

// קבוצות
const GAMBLING_CMDS = new Set(["coinflip", "dice", "daily", "work", "roulette", "fight"]);

// עזרה
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

/* ---------------- Users helpers ---------------- */
async function ensureUsernameOnce(userId, displayName) {
  if (!displayName) return;
  const { data, error } = await SUPABASE
    .from("users").select("username").eq("id", userId).maybeSingle();
  if (error) { console.log("sb select username err:", error.message); return; }

  if (!data) {
    const { error: insErr } = await SUPABASE.from("users")
      .insert({ id: userId, username: displayName, balance: 100, last_daily: null, last_work: null });
    if (insErr) console.log("sb insert user err:", insErr.message);
    return;
  }
  if (data.username == null) {
    const { error: upErr } = await SUPABASE.from("users")
      .update({ username: displayName }).eq("id", userId).is("username", null);
    if (upErr) console.log("sb update username err:", upErr.message);
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

/* ---------------- Discord helpers ---------------- */
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

/* ---------------- Roulette logic ---------------- */
// multiplier for next round: round 1→1.1, 2→1.2, ...
function nextMultiplier(roundNext) { return 1 + (roundNext / 10); }

/* ---------------- Lottery embeds ---------------- */
function formatIL(dt = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const d  = new Date(dt);
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yy = String(d.getFullYear()).slice(-2);
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${dd}/${mm}/${yy} | ${hh}:${mi}`;
}
function lotteryOpenEmbed(number, total, chancesLines) {
  return {
    content: "",
    embeds: [{
      title: `🎉  **הגרלה מספר #${number}**  🎉`,
      description:
        `${formatIL()} \n─────────────────────────────\n` +
        `💰 **סכום זכייה:** ${total} מטבעות\n` +
        `─────────────────────────────\n` +
        `🎲 **סיכויי זכייה:**\n` +
        (chancesLines.length ? chancesLines.join("\n") : "_אין משתתפים נוספים_\n") +
        `\n─────────────────────────────\n` +
        `🔔 **לקבלת עדכונים על הגרלות עתידיות**\n` +
        `||<@&1418491938704719883>||`,
      color: 16754176,
      footer: { text: "⏳עדכון בזמן אמת לפי הצטרפויות" }
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

/* ---------------- Handler ---------------- */
export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const sig = event.headers["x-signature-ed25519"];
  const ts  = event.headers["x-signature-timestamp"];
  if (!sig || !ts) return { statusCode: 401, body: "Missing signature headers" };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64")
                                    : Buffer.from(event.body || "", "utf8");

  let ok = false;
  try { ok = await verifyKey(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY); } catch {}
  if (!ok) return { statusCode: 401, body: "Bad request signature" };

  const body = JSON.parse(raw.toString("utf8"));

  // PING
  if (body?.type === 1) return json({ type: 1 });

  /* ---------- BUTTONS (type 3) ---------- */
  if (body?.type === 3 && body.data?.component_type === 2) {
    const custom = body.data.custom_id || "";
    const userId = body.member?.user?.id || body.user?.id;
    const username = body.member?.user?.username || body.user?.username || "חבר";

    // רולטה – Hit/Cash
    if (custom.startsWith("roulette_hit:") || custom.startsWith("roulette_cash:")) {
      const sessionId = custom.split(":")[1];

      // הבא את הסשן החי
      const { data: sess } = await SUPABASE.from("roulette_sessions")
        .select("*").eq("id", sessionId).maybeSingle();
      if (!sess || !sess.active) {
        return json({ type: 7, data: { content: "❌ הסשן הזה כבר נסגר.", components: [] } });
      }
      if (sess.user_id !== userId) {
        return json({ type: 7, data: { content: "❌ רק פותח הסשן יכול ללחוץ בכפתורים שלו.", components: [] } });
      }

      if (custom.startsWith("roulette_cash:")) {
        // Cash out – מחזירים pot לשחקן
        const user = await getUser(userId);
        const newBal = (user.balance ?? 100) + sess.pot;
        await setUser(userId, { balance: newBal });
        await SUPABASE.from("roulette_sessions").update({ active: false }).eq("id", sessionId);

        return json({
          type: 7,
          data: {
            content: `🎰 ${username} פרש עם **${sess.pot}**. יתרה: **${newBal}**`,
            components: []
          }
        });
      }

      // Hit – קודם בודקים בסט 20%
      const bust = Math.random() < 0.2;
      if (bust) {
        await SUPABASE.from("roulette_sessions").update({ active: false }).eq("id", sessionId);
        return json({
          type: 7,
          data: {
            content: `💥 הפסדת הכל! הסשן נסגר.`,
            components: []
          }
        });
      }

      // לא התפוצץ – מעלים round ומכפילים
      const nextRound = sess.round + 1; // round 1→1.1
      const mult = nextMultiplier(nextRound);
      const newPot = Math.max(1, Math.floor(sess.pot * mult));
      await SUPABASE.from("roulette_sessions")
        .update({ round: nextRound, pot: newPot })
        .eq("id", sessionId);

      return json({
        type: 7,
        data: {
          content:
            `🎰 סיבוב ${nextRound} — מכפיל ${mult.toFixed(1)}x | קופה: **${newPot}**\n` +
            `סיכוי להפסיד עכשיו: **20%**.\n` +
            `מה הלאה?`,
          components: [row([
            btn(`roulette_hit:${sessionId}`,   "להמשיך 🎲", 1),
            btn(`roulette_cash:${sessionId}`,  "לפרוש 💸",  4)
          ])]
        }
      });
    }

    // פייט – Join
    if (custom.startsWith("fight_join:")) {
      const fightId = custom.split(":")[1];
      const { data: fight } = await SUPABASE.from("fights").select("*").eq("id", fightId).maybeSingle();
      if (!fight || fight.status !== "open") {
        return json({ type: 7, data: { content: "❌ הקרב כבר נסגר/לא קיים.", components: [] } });
      }
      if (fight.challenger_id === userId) {
        return json({ type: 7, data: { content: "❌ אי אפשר להצטרף לקרב של עצמך.", components: [] } });
      }

      // גביית סכום מהמצטרף (בדיקה שיש מספיק)
      const joiner = await getUser(userId);
      if ((joiner.balance ?? 100) < fight.amount) {
        return json({ type: 4, data: { content: "❌ אין לך מספיק מטבעות כדי להצטרף." } });
      }

      // נסמן Opponent רק אם עדיין פנוי (כדי למנוע דאבל־קליק)
      const { data: updated, error } = await SUPABASE
        .from("fights")
        .update({ opponent_id: userId, status: "locked" })
        .eq("id", fightId)
        .is("opponent_id", null)
        .eq("status", "open")
        .select();
      if (error || !updated || !updated.length) {
        return json({ type: 7, data: { content: "מישהו הקדים אותך. הקרב כבר נתפס.", components: [] } });
      }

      // מחייבים את המצטרף
      await setUser(userId, { balance: (joiner.balance ?? 100) - fight.amount });

      // מגרילים מנצח
      const winner = Math.random() < 0.5 ? fight.challenger_id : userId;
      const pot = fight.amount * 2;

      const w = await getUser(winner);
      await setUser(winner, { balance: (w.balance ?? 100) + pot });

      // מסיימים את הקרב
      await SUPABASE.from("fights")
        .update({ status: "resolved", winner_id: winner })
        .eq("id", fightId);

      return json({
        type: 7,
        data: {
          content:
            `⚔️ קרב הוכרע! המנצח: <@${winner}> — לקח **${pot}** מטבעות.\n` +
            `תודה על ההשתתפות.`,
          components: []
        }
      });
    }

    // ברירת מחדל
    return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
  }

  /* ---------- SLASH (type 2) ---------- */
  if (body?.type === 2) {
    const cmd  = body.data.name;
    const opts = Object.fromEntries((body.data.options || []).map(o => [o.name, o.value]));
    const userId   = body.member?.user?.id || body.user?.id;
    const username = body.member?.user?.username || body.user?.username || "חבר";
    const display  = body.member?.nick || body.member?.user?.global_name || body.user?.global_name || username;
    const channelId = body.channel_id;
    const guildId   = body.guild_id;

    await ensureUsernameOnce(userId, display);

    // הגבלת חדר להימורים (לא לוטו)
    if (GAMBLING_CMDS.has(cmd) && channelId && channelId !== ALLOWED_GAMBLING_CHANNEL) {
      return json({ type: 4, data: { content: `🎲 הימורים רק בחדר <#${ALLOWED_GAMBLING_CHANNEL}>` } });
    }

    // ===== כל הפקודות הקיימות =====
    if (cmd === "balance") {
      const u = await getUser(userId);
      return json({ type: 4, data: { content: `💰 ${username}, היתרה שלך: **${u.balance}** מטבעות` } });
    }

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
      if (amount > u.balance) {
        return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה שלך: ${u.balance}.` } });
      }
      const flip = Math.random() < 0.5 ? "heads" : "tails";
      let balance = u.balance;
      if (flip === choice) { balance += amount; } else { balance -= amount; }
      await setUser(userId, { balance });
      return json({ type: 4, data: { content: `🪙 יצא **${flip}** — ${flip === choice ? `זכית! +${amount}` : `הפסדת... -${amount}`} → יתרה: **${balance}**` } });
    }

    if (cmd === "dice") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: `❌ סכום הימור לא תקין.` } });
      const { data } = await SUPABASE.from("users").select("balance").eq("id", userId).maybeSingle();
      let balance = data?.balance ?? 100;
      if (balance < amount) return json({ type: 4, data: { content: `${username}, אין לך מספיק מטבעות 🎲` } });

      const uRoll = Math.floor(Math.random() * 6) + 1;
      const bRoll = Math.floor(Math.random() * 6) + 1;
      if (uRoll > bRoll) balance += amount;
      else if (uRoll < bRoll) balance -= amount;
      await SUPABASE.from("users").upsert({ id: userId, balance });
      const text = uRoll === bRoll
        ? `🎲 תיקו! אתה: **${uRoll}**, בוט: **${bRoll}** — אין שינוי (יתרה: ${balance})`
        : `🎲 אתה: **${uRoll}**, בוט: **${bRoll}** — ${uRoll > bRoll ? `ניצחת! +${amount}` : `הפסדת... -${amount}`} → יתרה: **${balance}**`;
      return json({ type: 4, data: { content: text } });
    }

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
      return json({ type: 4, data: { content: `🤝 העברת **${amount}** מטבעות ל־<@${target}>.` } });
    }

    if (cmd === "top") {
      const { data } = await SUPABASE.from("users").select("id, balance").order("balance", { ascending: false }).limit(10);
      if (!data || !data.length) return json({ type: 4, data: { content: `אין עדיין נתונים ללוח הובלות.` } });
      const lines = data.map((u, i) => `**${i + 1}.** <@${u.id}> — ${u.balance}`);
      return json({ type: 4, data: { content: `🏆 טופ 10 עשירים:\n${lines.join("\n")}` } });
    }

    // ===== חדש: רולטה =====
    if (cmd === "roulette") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: "❌ סכום לא תקין." } });

      // אין לפתוח רולטה נוספת אם יש פעילה
      const { data: existing } = await SUPABASE
        .from("roulette_sessions").select("id").eq("user_id", userId).eq("active", true).maybeSingle();
      if (existing) return json({ type: 4, data: { content: "❌ יש לך סשן רולטה פעיל. סיים אותו קודם." } });

      const u = await getUser(userId);
      if (u.balance < amount) return json({ type: 4, data: { content: "❌ אין לך מספיק מטבעות." } });

      // מחייבים סטייק ומתחילים קופה שווה לסכום
      await setUser(userId, { balance: u.balance - amount });
      const { data: sessRow } = await SUPABASE.from("roulette_sessions").insert({
        user_id: userId, guild_id: guildId, channel_id: channelId,
        stake: amount, pot: amount, round: 0, active: true
      }).select().maybeSingle();

      const nextMult = nextMultiplier(1); // 1.1x
      return json({
        type: 4,
        data: {
          content:
            `🎰 רולטה נפתחה ל־${username} — קופה התחלתית: **${amount}**\n` +
            `המכפיל הבא: **${nextMult.toFixed(1)}x**, סיכוי להפסיד בכל סיבוב: **20%**.\n` +
            `להמשיך או לפרוש?`,
          components: [row([
            btn(`roulette_hit:${sessRow.id}`,  "להמשיך 🎲", 1),
            btn(`roulette_cash:${sessRow.id}`, "לפרוש 💸",  4)
          ])]
        }
      });
    }

    // ===== חדש: פייט =====
    if (cmd === "fight") {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: "❌ סכום לא תקין." } });

      const u = await getUser(userId);
      if (u.balance < amount) return json({ type: 4, data: { content: "❌ אין לך מספיק מטבעות לפתוח קרב." } });

      await setUser(userId, { balance: u.balance - amount });
      const { data: fight } = await SUPABASE.from("fights").insert({
        challenger_id: userId, amount, guild_id: guildId, channel_id: channelId, status: "open"
      }).select().maybeSingle();

      // מחזירים הודעה עם כפתור Join לערוץ (אותה הודעה תתעדכן בהמשך בלחיצה)
      return json({
        type: 4,
        data: {
          content:
            `⚔️ <@${userId}> פתח קרב על **${amount}** מטבעות. ` +
            `מי שמצטרף, הזוכה לוקח **${amount * 2}**. לחץ להצטרפות:`,
          components: [row([btn(`fight_join:${fight.id}`, "Join", 1)])]
        }
      });
    }

    // ===== חדש: לוטו =====
    if (cmd === "lottery") {
      const sub = (body.data.options?.[0]?.name) || "join";

      // מוודא שיש הגרלה פתוחה או יוצר חדשה
      async function getOrCreateOpenLottery() {
        let { data: lotto } = await SUPABASE.from("lotteries")
          .select("*").eq("is_open", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (lotto) return lotto;

        // יוצר חדשה ומפרסם EMBED בערוץ הייעודי
        const { data: created } = await SUPABASE.from("lotteries")
          .insert({ channel_id: LOTTERY_CHANNEL_ID }).select().maybeSingle();

        // בהתחלה אין משתתפים – נדחוף 0 עדכון
        const embed = lotteryOpenEmbed(created.number, 0, []);
        const msg = await postChannelMessage(LOTTERY_CHANNEL_ID, embed);

        await SUPABASE.from("lotteries")
          .update({ message_id: msg.id })
          .eq("id", created.id);

        return { ...created, message_id: msg.id };
      }

      // מחשב ומעדכן EMBED של ההגרלה
      async function refreshLotteryMessage(lottoId) {
        const { data: lotto } = await SUPABASE.from("lotteries").select("*").eq("id", lottoId).maybeSingle();
        if (!lotto) return;

        const { data: entries } = await SUPABASE
          .from("lottery_entries").select("user_id, amount").eq("lottery_id", lottoId);

        const total = (entries || []).reduce((s, e) => s + e.amount, 0);
        const lines = (entries || []).map(e => {
          const pct = total ? Math.round((e.amount / total) * 100) : 0;
          return `<@${e.user_id}> → ${pct}%`;
        });

        const payload = lotteryOpenEmbed(lotto.number, total, lines);
        await editChannelMessage(lotto.channel_id, lotto.message_id, payload);
      }

      if (sub === "join") {
        const amount = parseInt(body.data.options?.[0]?.options?.[0]?.value ?? 0, 10);
        if (!Number.isInteger(amount) || amount <= 0) return json({ type: 4, data: { content: "❌ סכום לא תקין." } });

        const u = await getUser(userId);
        if (u.balance < amount) return json({ type: 4, data: { content: "❌ אין לך מספיק מטבעות." } });

        const lotto = await getOrCreateOpenLottery();

        // מורידים כסף למשתמש
        await setUser(userId, { balance: u.balance - amount });

        // מוסיפים/מעדכנים כניסה (מצטבר למשתמש)
        const { data: existing } = await SUPABASE
          .from("lottery_entries").select("*").eq("lottery_id", lotto.id).eq("user_id", userId).maybeSingle();

        if (existing) {
          await SUPABASE.from("lottery_entries")
            .update({ amount: existing.amount + amount })
            .eq("id", existing.id);
        } else {
          await SUPABASE.from("lottery_entries")
            .insert({ lottery_id: lotto.id, user_id: userId, amount });
        }

        // עדכון הודעת הלוטו
        await refreshLotteryMessage(lotto.id);

        return json({ type: 4, data: { content: `🎟️ נכנסת להגרלה #${lotto.number} עם **${amount}**.` } });
      }

      if (sub === "status") {
        const { data: lotto } = await SUPABASE.from("lotteries")
          .select("*").eq("is_open", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (!lotto) return json({ type: 4, data: { content: "אין כרגע הגרלה פתוחה." } });

        await editChannelMessage(lotto.channel_id, lotto.message_id,
          lotteryOpenEmbed(lotto.number, 0, [])); // רענון כותרת/זמן
        await (async () => {
          const { data: entries } = await SUPABASE
            .from("lottery_entries").select("user_id, amount").eq("lottery_id", lotto.id);
          const total = (entries || []).reduce((s, e) => s + e.amount, 0);
          const lines = (entries || []).map(e => {
            const pct = total ? Math.round((e.amount / total) * 100) : 0;
            return `<@${e.user_id}> → ${pct}%`;
          });
          await editChannelMessage(lotto.channel_id, lotto.message_id, lotteryOpenEmbed(lotto.number, total, lines));
        })();

        return json({ type: 4, data: { content: `🔄 עודכן סטטוס ההגרלה בערוץ <#${LOTTERY_CHANNEL_ID}>.` } });
      }

      if (sub === "draw") {
        const { data: lotto } = await SUPABASE.from("lotteries")
          .select("*").eq("is_open", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (!lotto) return json({ type: 4, data: { content: "אין הגרלה פתוחה." } });

        const { data: entries } = await SUPABASE
          .from("lottery_entries").select("user_id, amount").eq("lottery_id", lotto.id);
        const total = (entries || []).reduce((s, e) => s + e.amount, 0);
        if (!total) return json({ type: 4, data: { content: "אין משתתפים — אי אפשר לבצע הגרלה." } });

        // בחירה משוקללת
        const r = Math.floor(Math.random() * total);
        let acc = 0, winner = entries[0].user_id;
        for (const e of entries) { acc += e.amount; if (r < acc) { winner = e.user_id; break; } }

        // פרס למנצח
        const w = await getUser(winner);
        await setUser(winner, { balance: (w.balance ?? 100) + total });

        // סוגרים ההגרלה
        await SUPABASE.from("lotteries")
          .update({ is_open: false, closed_at: new Date().toISOString() })
          .eq("id", lotto.id);

        // משנים EMBED לזוכה
        await editChannelMessage(lotto.channel_id, lotto.message_id, lotteryWinnerEmbed(lotto.number, winner, total));

        return json({ type: 4, data: { content: `🏆 בוצעה הגרלה #${lotto.number}. הזוכה: <@${winner}> (פרס: ${total}).` } });
      }

      return json({ type: 4, data: { content: "פקודת לוטו לא מוכרת." } });
    }

    // לא זוהתה פקודה
    return json({ type: 4, data: { content: `הפקודה לא מוכרת.` } });
  }

  return json({ type: 5 });
}
