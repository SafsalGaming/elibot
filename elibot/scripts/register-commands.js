// scripts/register-commands.js
import { fetch } from "undici";

const APP_ID   = process.env.DISCORD_APPLICATION_ID;
const TOKEN    = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN) {
  console.error("חסר APP_ID או TOKEN בסביבה");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("חסר GUILD_ID (לגילד). אם אתה רוצה גלובלי, תחליף ל- /applications/{APP_ID}/commands");
  process.exit(1);
}

const API = "https://discord.com/api/v10";
const base = `${API}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
const headers = {
  "Authorization": `Bot ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (register,1.0)"
};

const commands = [
  { name: "hello", description: "אומר שלום", type: 1 }
];

const mode = process.argv.includes("--list") ? "list"
           : process.argv.includes("--clear") ? "clear"
           : "register";

async function mustOk(res, label) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${label} failed: ${res.status} ${res.statusText} — ${text}`);
  }
  return res;
}

(async () => {
  console.log("APP_ID:", APP_ID, "GUILD_ID:", GUILD_ID);
  console.log("Endpoint:", base, "Mode:", mode);

  if (mode === "list") {
    const r = await mustOk(await fetch(base, { headers }), "LIST");
    const data = await r.json();
    console.log("פקודות בגילד:", data.map(c => ({ id: c.id, name: c.name })));
    return;
  }

  if (mode === "clear") {
    const r = await mustOk(await fetch(base, { headers }), "GET before DELETE");
    const data = await r.json();
    for (const cmd of data) {
      const del = await mustOk(await fetch(`${base}/${cmd.id}`, { method: "DELETE", headers }), `DELETE ${cmd.name}`);
      console.log(`מחקתי ${cmd.name}: ${del.status}`);
    }
    return;
  }

  // register (bulk overwrite)
  const put = await mustOk(await fetch(base, { method: "PUT", headers, body: JSON.stringify(commands) }), "PUT register");
  const after = await put.json();
  console.log("נרשם בהצלחה:", after.map(c => ({ id: c.id, name: c.name })));

  // וידוא מיידי
  const verify = await mustOk(await fetch(base, { headers }), "GET verify");
  const listed = await verify.json();
  console.log("כרגע בגילד:", listed.map(c => ({ id: c.id, name: c.name })));
})().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
