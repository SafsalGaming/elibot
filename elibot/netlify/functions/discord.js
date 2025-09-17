import { verifyKey } from "discord-interactions";

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

export async function handler(event) {
  const v = "v4";
  console.log("start", v, { method: event.httpMethod, b64: !!event.isBase64Encoded });

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const sig = event.headers["x-signature-ed25519"];
  const ts  = event.headers["x-signature-timestamp"];
  console.log("hdrs", { hasSig: !!sig, hasTs: !!ts });

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  let ok = false;
  try {
    ok = verifyKey(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY);
  } catch (e) {
    console.log("verifyKey error", String(e));
  }
  console.log("sig ok?", ok);

  if (!ok) {
    return { statusCode: 401, body: "Bad request signature" };
  }

  const body = JSON.parse(raw.toString("utf8"));
  console.log("type", body?.type);

  if (body?.type === 1) {
    return json({ type: 1 });
  }

  if (body?.type === 2 && body.data?.name === "hello") {
    const user = body.member?.user?.username || body.user?.username || "חבר";
    return json({ type: 4, data: { content: `הלו הלו ${user} 👋` } });
  }

  return json({ type: 5 });
}
