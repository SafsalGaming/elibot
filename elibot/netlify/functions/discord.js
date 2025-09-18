import { verifyKey } from "discord-interactions";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj)
});

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const sig = event.headers["x-signature-ed25519"];
  const ts  = event.headers["x-signature-timestamp"];
  if (!sig || !ts) return { statusCode: 401, body: "Missing signature headers" };

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  let ok = false;
  try { ok = await verifyKey(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY); } catch {}
  if (!ok) return { statusCode: 401, body: "Bad request signature" };

  const body = JSON.parse(raw.toString("utf8"));
  if (body?.type === 1) return json({ type: 1 });

  if (body?.type === 2) {
    const cmd = body.data.name;
    const userId = body.member?.user?.id;
    const username = body.member?.user?.username;

    switch (cmd) {
      case "balance": {
        const { data } = await supabase
          .from("users")
          .select("balance")
          .eq("id", userId)
          .maybeSingle();

        let balance = data?.balance ?? 100;
        if (!data) {
          await supabase.from("users").insert({ id: userId, balance });
        }

        return json({ type: 4, data: { content: `${username}, you have ${balance} coins 💰` } });
      }

      case "daily": {
        const { data } = await supabase
          .from("users")
          .select("balance, last_daily")
          .eq("id", userId)
          .maybeSingle();

        let balance = data?.balance ?? 100;
        const now = new Date();
        const lastDaily = data?.last_daily ? new Date(data.last_daily) : null;

        if (lastDaily && now - lastDaily < 24 * 60 * 60 * 1000) {
          return json({ type: 4, data: { content: `${username}, you already claimed your daily bonus ⏳` } });
        }

        balance += 20;
        if (data) {
          await supabase.from("users").update({ balance, last_daily: now.toISOString() }).eq("id", userId);
        } else {
          await supabase.from("users").insert({ id: userId, balance, last_daily: now.toISOString() });
        }

        return json({ type: 4, data: { content: `${username}, you claimed 20 coins! 🎁 Balance: ${balance}` } });
      }

      case "coinflip": {
        const choice = body.data.options.find(o => o.name === "choice").value;
        const amount = body.data.options.find(o => o.name === "amount").value;

        const { data } = await supabase
          .from("users")
          .select("balance")
          .eq("id", userId)
          .maybeSingle();

        let balance = data?.balance ?? 100;
        if (balance < amount) {
          return json({ type: 4, data: { content: `${username}, you don't have enough coins 💸` } });
        }

        const result = Math.random() < 0.5 ? "heads" : "tails";
        balance = result === choice ? balance + amount : balance - amount;

        if (data) {
          await supabase.from("users").update({ balance }).eq("id", userId);
        } else {
          await supabase.from("users").insert({ id: userId, balance });
        }

        return json({
          type: 4,
          data: { content: `${username} bet ${amount} on ${choice}. Coin landed on **${result}** → Balance: ${balance}` }
        });
      }

      case "give": {
        const target = body.data.options.find(o => o.name === "user").value;
        const amount = body.data.options.find(o => o.name === "amount").value;

        const { data } = await supabase
          .from("users")
          .select("balance")
          .eq("id", userId)
          .maybeSingle();

        let balance = data?.balance ?? 100;
        if (balance < amount) {
          return json({ type: 4, data: { content: `${username}, you don't have enough coins 💸` } });
        }

        balance -= amount;
        await supabase.from("users").upsert({ id: userId, balance });

        const { data: targetData } = await supabase
          .from("users")
          .select("balance")
          .eq("id", target)
          .maybeSingle();

        let targetBalance = targetData?.balance ?? 100;
        targetBalance += amount;
        await supabase.from("users").upsert({ id: target, balance: targetBalance });

        return json({
          type: 4,
          data: { content: `${username} gave <@${target}> ${amount} coins. Your balance: ${balance}, Their balance: ${targetBalance}` }
        });
      }
    }
  }

  return json({ type: 5 });
}
