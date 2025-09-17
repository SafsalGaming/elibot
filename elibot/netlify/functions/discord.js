import { verifyKey } from "discord-interactions";

export async function handler(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const signature = event.headers["x-signature-ed25519"];
  const timestamp = event.headers["x-signature-timestamp"];

  // הגוף הגולמי (חובה לאימות חתימה)
  const rawBodyBuf = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  // אימות חתימה
  let isValid = false;
  try {
    isValid = verifyKey(
      rawBodyBuf,
      signature,
      timestamp,
      process.env.DISCORD_PUBLIC_KEY
    );
  } catch {}
  if (!isValid) return { statusCode: 401, body: "Bad request signature" };

  const body = JSON.parse(rawBodyBuf.toString("utf8"));

  // PING
  if (body?.type === 1) {
    return json({ type: 1 });
  }

  // SLASH COMMANDS
  if (body?.type === 2) {
    const name = body.data.name;
    if (name === "hello") {
      const user = body.member?.user?.username || body.user?.username || "חבר";
      return json({
        type: 4,
        data: { content: `הלו הלו ${user} 👋` }
      });
    }
    return json({ type: 4, data: { content: "לא מכיר את הפקודה." } });
  }

  // כאן בעתיד תטפל בכפתורים (type === 3)

  return json({ type: 5 });
}

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
