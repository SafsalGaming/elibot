import { verifyKey } from "discord-interactions";

const VERSION = "v6"; // לזיהוי בלוגים

const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj)
});

export async function handler(event) {
  console.log("start", VERSION, { method: event.httpMethod, b64: !!event.isBase64Encoded });

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const sig = event.headers["x-signature-ed25519"];
  const ts  = event.headers["x-signature-timestamp"];
  console.log("hdrs", { hasSig: !!sig, hasTs: !!ts });

  // אם אין בכלל כותרות חתימה – תחזיר 401 מייד
  if (!sig || !ts) {
    console.log("missing signature headers");
    return { statusCode: 401, body: "Missing signature headers" };
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  let ok = false;
  try {
    ok = await verifyKey(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY); // חשוב ה־await
  } catch (e) {
    console.log("verifyKey error", String(e));
  }
  console.log("sig ok?", ok);

  if (!ok) return { statusCode: 401, body: "Bad request signature" };

  const body = JSON.parse(raw.toString("utf8"));
  console.log("type", body?.type);

  if (body?.type === 1) return json({ type: 1 });
if (body?.type === 2) {
  const cmd = body.data?.name;

  if (cmd === "hello") {
    const user = body.member?.user?.username || body.user?.username || "friend";
    return json({ type: 4, data: { content: `Hello ${user} 👋` } });
  }

  if (cmd === "balance") {
    return json({ type: 4, data: { content: `You have 100 coins 💰` } });
  }

  if (cmd === "daily") {
    return json({ type: 4, data: { content: `You claimed your daily 50 coins! 🤑` } });
  }

  if (cmd === "coinflip") {
    const choice = body.data.options.find(o => o.name === "choice").value;
    const amount = body.data.options.find(o => o.name === "amount").value;
    const flip = Math.random() < 0.5 ? "heads" : "tails";
    const win = flip === choice;
    return json({
      type: 4,
      data: {
        content: `Coin landed on **${flip}**. You ${win ? `won ${amount} 🎉` : `lost ${amount} 😢`}`
      }
    });
  }

  if (cmd === "give") {
    const user = body.data.options.find(o => o.name === "user").value;
    const amount = body.data.options.find(o => o.name === "amount").value;
    return json({
      type: 4,
      data: { content: `Gave <@${user}> ${amount} coins 🤝` }
    });
  }
}


  return json({ type: 5 });
}

