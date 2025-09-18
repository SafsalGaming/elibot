import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";
const ALLOWED_GAMBLING_CHANNEL = "1418196736958005361";
const GAMBLING_CMDS = new Set(["coinflip", "dice", "daily", "work"]);


const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj)
});

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

async function getUser(userId) {
  const { data } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
  if (!data) {
    const row = { id: userId, balance: 100, last_daily: null, last_work: null };
    await supabase.from("users").insert(row);
    return row;
  }
  return data;
}

async function setUser(userId, patch) {
  await supabase.from("users").upsert({ id: userId, ...patch });
}

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
  if (body?.type === 1) return json({ type: 1 }); // PING

  if (body?.type === 2) {
    const cmd = body.data.name;
    const opts = Object.fromEntries((body.data.options || []).map(o => [o.name, o.value]));
    const userId = body.member?.user?.id || body.user?.id;
    const username = body.member?.user?.username || body.user?.username || "חבר";

    // /balance
    if (cmd === "balance") {
      const u = await getUser(userId);
      return json({ type: 4, data: { content: `💰 ${username}, היתרה שלך: **${u.balance}** מטבעות` } });
    }

    // /daily (+50, 24h)
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

    // מזהה הצ'אנל שבו הופעלה הפקודה (בגילד אינטראקציות יש channel_id)
const channelId = body.channel_id;

// אם זו פקודת הימורים וצ'אנל לא מותר – נחסום עם הודעה וקישור לצ'אנל הנכון
if (GAMBLING_CMDS.has(cmd) && channelId && channelId !== ALLOWED_GAMBLING_CHANNEL) {
  return json({
    type: 4,
    data: {
      content: `🎲<#${ALLOWED_GAMBLING_CHANNEL}> הימורים רק בחדר`,
    }
  });
}

    
    // /work (+10, 1h)
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

    // /coinflip choice amount
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
      if (flip === choice) {
        balance += amount;
        await setUser(userId, { balance });
        return json({ type: 4, data: { content: `🪙 יצא **${flip}** — זכית! +${amount}. יתרה: **${balance}**` } });
      } else {
        balance -= amount;
        await setUser(userId, { balance });
        return json({ type: 4, data: { content: `🪙 יצא **${flip}** — הפסדת... -${amount}. יתרה: **${balance}**` } });
      }
    }

    // /dice guess amount (d6, payout x5 על פגיעה מדויקת)
    if (cmd === "dice") {
      const guess = parseInt(opts.guess, 10);
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(guess) || guess < 1 || guess > 6) {
        return json({ type: 4, data: { content: `❌ ניחוש חייב להיות בין 1 ל־6.` } });
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        return json({ type: 4, data: { content: `❌ סכום הימור לא תקין.` } });
      }

      const u = await getUser(userId);
      if (amount > u.balance) {
        return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה שלך: ${u.balance}.` } });
      }

      const roll = 1 + Math.floor(Math.random() * 6);
      let balance = u.balance;
      if (roll === guess) {
        const win = amount * 5; // house edge קל
        balance += win;
        await setUser(userId, { balance });
        return json({ type: 4, data: { content: `🎲 יצא **${roll}** — בול! זכית **+${win}**. יתרה: **${balance}**` } });
      } else {
        balance -= amount;
        await setUser(userId, { balance });
        return json({ type: 4, data: { content: `🎲 יצא **${roll}** — פספוס. הפסדת **-${amount}**. יתרה: **${balance}**` } });
      }
    }

    // /give user amount
    if (cmd === "give") {
      const target = opts.user; // user id
      const amount = parseInt(opts.amount, 10);
      if (!target || target === userId) {
        return json({ type: 4, data: { content: `❌ משתמש לא תקין.` } });
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        return json({ type: 4, data: { content: `❌ סכום לא תקין.` } });
      }

      const u = await getUser(userId);
      if (u.balance < amount) {
        return json({ type: 4, data: { content: `❌ אין לך מספיק מטבעות. היתרה: ${u.balance}.` } });
      }

      const receiver = await getUser(target);
      const senderBal = u.balance - amount;
      const recvBal = (receiver.balance ?? 100) + amount;
      await setUser(userId, { balance: senderBal });
      await setUser(target,  { balance: recvBal });

      return json({ type: 4, data: { content: `🤝 העברת **${amount}** מטבעות ל־<@${target}>. היתרה שלך: **${senderBal}**, שלו: **${recvBal}**` } });
    }

    // /top
    if (cmd === "top") {
      const { data } = await supabase
        .from("users")
        .select("id, balance")
        .order("balance", { ascending: false })
        .limit(10);

      if (!data || data.length === 0) {
        return json({ type: 4, data: { content: `אין עדיין נתונים ללוח הובלות.` } });
      }

      const lines = data.map((u, i) => `**${i+1}.** <@${u.id}> — ${u.balance}`);
      return json({ type: 4, data: { content: `🏆 טופ 10 עשירים:\n${lines.join("\n")}` } });
    }

    return json({ type: 4, data: { content: `הפקודה לא מוכרת.` } });
  }

  return json({ type: 5 });
}


