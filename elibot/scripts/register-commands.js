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

// כל הפקודות:
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
  type: 1,
  dm_permission: false
}
];


const mode = process.argv.includes("--list") ? "list"
           : process.argv.includes("--clear") ? "clear"
           : "register";

async function main() {
  const base = `${API}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;

  if (mode === "list") {
    const r = await fetch(base, { headers });
    console.log("Guild commands:", (await r.json()).map(c => ({ id: c.id, name: c.name })));
    return;
  }

  if (mode === "clear") {
    const r = await fetch(base, { headers });
    const data = await r.json();
    for (const cmd of data) {
      const del = await fetch(`${base}/${cmd.id}`, { method: "DELETE", headers });
      console.log(`Deleted ${cmd.name}: ${del.status}`);
    }
    return;
  }

  const put = await fetch(base, { method: "PUT", headers, body: JSON.stringify(commands) });
  if (!put.ok) {
    const body = await put.text();
    console.error("Register failed:", put.status, body);
    process.exit(1);
  }
  const after = await put.json();
  console.log("Registered:", after.map(c => ({ id: c.id, name: c.name })));
}
main().catch(e => { console.error(e); process.exit(1); });


