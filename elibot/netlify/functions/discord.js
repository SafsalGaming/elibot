import { verifyKey } from "discord-interactions";

function json(obj, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    // דיסקורד תמיד שולח POST. GET בדפדפן יקבל 405 וזה תקין.
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const signature = event.headers["x-signature-ed25519"];
  const timestamp = event.headers["x-signature-timestamp"];

  // גוף גולמי בדיוק כפי שהגיע
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  // אימות חתימה
  let ok = false;
  try {
    ok = verifyKey(rawBody, signature, timestamp, process.env.DISCORD_PUBLIC_KEY);
  } catch {}
  if (!ok) return { statusCode: 401, body: "Bad request signature" };

  const body = JSON.parse(rawBody.toString("utf8"));

  // Ping מהפורטל
  if (body?.type === 1) {
    return json({ type: 1 }); // חייב להחזיר ככה
  }

  // Slash command
  if (body?.type === 2 && body.data?.name === "hello") {
    const user = body.member?.user?.username || body.user?.username || "חבר";
    return json({ type: 4, data: { content: `הלו הלו ${user} 👋` } });
  }

  return json({ type: 5 });
}
