import { request } from "undici";

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN  = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // אופציונלי לפיתוח מהיר

const commands = [
  {
    name: "hello",
    description: "אומר שלום",
    type: 1
  }
];

async function upsert(url, what) {
  const resp = await request(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bot ${TOKEN}`
    },
    body: JSON.stringify(commands)
  });
  const data = await resp.body.json();
  if (resp.statusCode >= 200 && resp.statusCode < 300) {
    console.log(`נרשמו ${what}:`, data.map(c => c.name));
  } else {
    console.error(`נכשל (${what}):`, resp.statusCode, data);
    process.exit(1);
  }
}

async function main() {
  const scope = process.argv[2]; // "guild" או undefined
  if (scope === "guild") {
    if (!GUILD_ID) throw new Error("צריך DISCORD_GUILD_ID כדי לרשום לגילד");
    const url = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
    await upsert(url, "פקודות גילד");
  } else {
    const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
    await upsert(url, "פקודות גלובליות");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
