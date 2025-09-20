// scripts/register-commands.js
import { fetch } from "undici";

const APP_ID   = process.env.DISCORD_APPLICATION_ID;
const TOKEN    = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN || !GUILD_ID) {
  console.error("Missing APP_ID or TOKEN or GUILD_ID");
  process.exit(1);
}

const API = "https://discord.com/api/v10";
const headers = {
  "Authorization": `Bot ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (register,1.0)"
};

// === כל הפקודות (שמור על שמות באנגלית, lowercase) ===
const commands = [
  { name: "balance", description: "Show your coin balance", type: 1 },
  { name: "daily",   description: "Claim daily bonus (+50 every 24h)", type: 1 },
  { name: "work",    description: "Earn +10 coins (hourly)", type: 1 },

  {
    name: "coinflip",
    description: "Bet on a coin flip",
    type: 1,
    options: [
      {
        name: "choice", description: "heads or tails", type: 3, required: true,
        choices: [{ name: "heads", value: "heads" }, { name: "tails", value: "tails" }]
      },
      { name: "amount", description: "Amount to bet", type: 4, required: true, min_value: 1 }
    ]
  },

  {
    name: "dice",
    description: "Roll a d6 vs bot (higher wins)",
    type: 1,
    options: [
      { name: "amount", description: "Amount to bet", type: 4, required: true, min_value: 1 }
    ]
  },

  {
    name: "give",
    description: "Give coins to another user",
    type: 1,
    options: [
      { name: "user", description: "Target user", type: 6, required: true },
      { name: "amount", description: "Amount to give", type: 4, required: true, min_value: 1 }
    ]
  },

  { name: "top", description: "Show top 10 richest", type: 1 },

  {
    name: "roulette",
    description: "Risk bet with rising multiplier (20% bust each hit)",
    type: 1,
    options: [
      { name: "amount", description: "Bet amount", type: 4, required: true, min_value: 1 }
    ]
  },

  {
    name: "fight",
    description: "Open a duel invitation; winner takes both bets",
    type: 1,
    options: [
      { name: "amount", description: "Bet amount for the fight", type: 4, required: true, min_value: 1 }
    ]
  },

  {
    name: "lottery",
    description: "Join the current lottery with an amount (opens one if none exists)",
    type: 1,
    options: [
      { name: "amount", description: "Amount to join", type: 4, required: true, min_value: 1 }
    ]
  },

  {
    name: "lottery_updates_role",
    description: "Toggle the Lottery Updates role for yourself",
    type: 1
  }
];

const mode = process.argv.includes("--list") ? "list"
           : process.argv.includes("--clear") ? "clear"
           : "register";

async function assertAppMatchesToken() {
  const me = await fetch(`${API}/applications/@me`, { headers });
  if (!me.ok) {
    console.error("Failed /applications/@me:", me.status, await me.text());
    process.exit(1);
  }
  const app = await me.json();
  console.log("Token belongs to Application ID:", app.id);
  if (String(app.id) !== String(APP_ID)) {
    console.error("❌ APP_ID does not match token's application. Fix DISCORD_APPLICATION_ID.");
    process.exit(1);
  }
}

async function listGuildCommands(base) {
  const r = await fetch(base, { headers });
  if (!r.ok) {
    console.error("List failed:", r.status, await r.text());
    process.exit(1);
  }
  const arr = await r.json();
  return arr;
}


async function bulkPutGuildCommands(base, cmds) {
  const res = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify(cmds)
  });
  const text = await res.text();
  console.log("PUT /commands:", res.status, text);
  if (!res.ok) {
    throw new Error(`Bulk PUT failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  console.log("Using APP_ID:", APP_ID, "GUILD_ID:", GUILD_ID);
  await assertAppMatchesToken();

  const base = `${API}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

  if (mode === "list") {
    const listed = await listGuildCommands(base);
    console.log("Guild commands:", listed.map(c => ({ id: c.id, name: c.name })));
    return;
  }

if (mode === "clear") {
  await bulkPutGuildCommands(base, []); // מוחק הכל בבקשה אחת
  console.log("Cleared all guild commands");
  return;
}


await bulkPutGuildCommands(base, commands);
const finalList = await listGuildCommands(base);
console.log("✅ Registered:", finalList.map(c => ({ id: c.id, name: c.name })));

}

main().catch(e => { console.error(e); process.exit(1); });

