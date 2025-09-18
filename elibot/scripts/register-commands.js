// scripts/register-commands.js
import { fetch } from "undici";

const APP_ID  = process.env.DISCORD_APPLICATION_ID;
const TOKEN   = process.env.DISCORD_TOKEN;
const GUILD_ID= process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN || !GUILD_ID) {
  console.error("חסר APP_ID או TOKEN או GUILD_ID בסביבה.");
  process.exit(1);
}

const API = "https://discord.com/api/v10";
const headers = {
  "Authorization": `Bot ${TOKEN}`,
  "Content-Type": "application/json"
};

// הגדר פה את כל הפקודות שלך
const commands = [
  { name: "hello", description: "אומר שלום", type: 1 }
];

const mode = process.argv.includes("--list") ? "list"
           : process.argv.includes("--clear") ? "clear"
           : "register";

async function main() {
  const base = `${API}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

  if (mode === "list") {
    const r = await fetch(base, { headers });
    const data = await r.json();
    console.log("פקודות בגילד:", data.map(c => ({ id: c.id, name: c.name })));
    return;
  }

  if (mode === "clear") {
    const r = await fetch(base, { headers });
    const data = await r.json();
    for (const cmd of data) {
      const del = await fetch(`${base}/${cmd.id}`, { method: "DELETE", headers });
      console.log(`מחקתי ${cmd.name}: ${del.status}`);
    }
    return;
  }

  // register (bulk overwrite)
  const put = await fetch(base, { method: "PUT", headers, body: JSON.stringify(commands) });
  if (!put.ok) {
    const body = await put.text();
    console.error("נכשל הרישום:", put.status, body);
    process.exit(1);
  }
  const after = await put.json();
  console.log("נרשם בהצלחה:", after.map(c => ({ id: c.id, name: c.name })));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
