// scripts/sync-commands.mjs
const API = "https://discord.com/api/v10";

// תעדף את אותו שם בכל מקום, אבל שיהיה פולי-בק אם פספסת
const APP_ID   = process.env.DISCORD_APPLICATION_ID;
const TOKEN    = process.env.DISCORD_TOKEN;          // בלי "Bot " בפנים!
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN || !GUILD_ID) {
  console.error("Missing APP_ID or TOKEN or GUILD_ID");
  process.exit(1);
}

const headers = {
  "Authorization": `Bot ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "Elibot/commands-sync"
};

// כל הפקודות שלך (גילד): שמור מעודכן, כולל ה-role
const commands = [
  { name: "balance", description: "Show your coin balance", type: 1 },
  { name: "daily",   description: "Claim daily bonus (+50 every 24h)", type: 1 },
  { name: "work",    description: "Earn +10 coins (hourly)", type: 1 },

  {
    name: "coinflip",
    description: "Bet on a coin flip",
    type: 1,
    options: [
      { name: "choice", description: "heads or tails", type: 3, required: true,
        choices: [{ name: "heads", value: "heads" }, { name: "tails", value: "tails" }] },
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

async function main() {
  console.log("Syncing guild commands…");
  // אימות שהטוקן מתאים ל-APP_ID
  const me = await fetch(`${API}/applications/@me`, { headers });
  if (!me.ok) {
    console.error("Failed /applications/@me:", me.status, await me.text());
    process.exit(1);
  }
  const app = await me.json();
  if (String(app.id) !== String(APP_ID)) {
    console.error("APP_ID mismatch. Token belongs to:", app.id, "but DISCORD_APPLICATION_ID is:", APP_ID);
    process.exit(1);
  }

  // Bulk overwrite – אטומי ומהיר
  const url = `${API}/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
  const put = await fetch(url, { method: "PUT", headers, body: JSON.stringify(commands) });
  const body = await put.text();
  console.log("PUT", put.status, body);

  if (!put.ok) process.exit(1);

  // הדפסה יפה בסוף
  const listed = await fetch(url, { headers });
  const arr = await listed.json();
  console.log("✅ Now on guild:", arr.map(c => ({ id: c.id, name: c.name })));
}

main().catch(e => { console.error(e); process.exit(1); });
