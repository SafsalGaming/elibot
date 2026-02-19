const ROULETTE_ROUND_TTL_MS = 10 * 60 * 1000;
const rouletteRoundConsumedUntil = new Map();
const rouletteRoundInFlight = new Set();

function isRouletteRoundConsumed(key) {
  const until = rouletteRoundConsumedUntil.get(key);
  if (!until) return false;
  if (until <= Date.now()) {
    rouletteRoundConsumedUntil.delete(key);
    return false;
  }
  return true;
}

function markRouletteRoundConsumed(key) {
  rouletteRoundConsumedUntil.set(key, Date.now() + ROULETTE_ROUND_TTL_MS);
}

export async function handleRouletteComponent(ctx) {
  const {
    body,
    cid,
    userId,
    username,
    guildId,
    channel,
    json,
    addRoleToMember,
    ROLE_BUTTON_ENFORCE_CHANNEL,
    ROLE_BUTTON_ENFORCE_MESSAGE,
    rouletteBustChance,
    rouletteCompoundedMultiplier,
    fmtN,
    row,
    btn,
    getUser,
    setUser,
  } = ctx;

  if (cid.startsWith("roulette:")) {
    const [, ownerId, betStr, roundStr, action] = cid.split(":");
    const bet   = parseInt(betStr, 10);
    const round = parseInt(roundStr, 10);
    const messageId = body.message?.id || body.id || "no-message";
  
    if (userId !== ownerId) {
      return json({ type: 4, data: { flags: 64, content: `❌ רק מי שהתחיל את הרולטה יכול ללחוץ.` } });
    }

    // מונע עיבוד כפול של אותו סיבוב (למשל לחיצות מהירות hit+cash)
    const roundKey = `${messageId}:${ownerId}:${bet}:${round}`;
    if (isRouletteRoundConsumed(roundKey) || rouletteRoundInFlight.has(roundKey)) {
      return json({ type: 4, data: { flags: 64, content: `⏳ הסיבוב הזה כבר טופל. השתמש בכפתורים העדכניים.` } });
    }
    rouletteRoundInFlight.add(roundKey);

    try {
  
      if (action === "hit") {
        markRouletteRoundConsumed(roundKey);
        const nextRound = round + 1;
        const bust = Math.random() < rouletteBustChance(nextRound); // ⚠️ סיכוי לפי הסיבוב הבא
        if (bust) {
          return json({
            type: 7,
            data: { content: `🎰 **BUST!** הפסדת (${fmtN(bet)}).`, components: [] }
          });
        }
    
        const payout = Math.floor(bet * rouletteCompoundedMultiplier(nextRound));
        const nextBustPct = Math.round(rouletteBustChance(nextRound + 1) * 100);
        return json({
          type: 7,
          data: {
            content: `🎰 רולטה — סיבוב ${nextRound} · סכום נוכחי: **${fmtN(payout)}** (סיכוי פיצוץ הבא: ${nextBustPct}%)`,
            components: [
              row([
                btn(`roulette:${ownerId}:${bet}:${nextRound}:hit`,  "המשך", 3),
                btn(`roulette:${ownerId}:${bet}:${nextRound}:cash`, "צא",    4),
              ])
            ]
          }
        });
      }

      if (action === "cash") {
        markRouletteRoundConsumed(roundKey);
        const payout = Math.floor(bet * rouletteCompoundedMultiplier(round));
        const profit = payout - bet;
    
        const u = await getUser(userId);
        const newBal = (u.balance ?? 100) + payout;
        await setUser(userId, { balance: newBal });
    
        return json({
          type: 7,
          data: {
            content: `💵 יצאת עם **${fmtN(payout)}** (רווח **+${fmtN(profit)}**). יתרה: **${fmtN(newBal)}**`,
            components: []
          }
        });
      }
    
      return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
    } finally {
      rouletteRoundInFlight.delete(roundKey);
    }
  }
  
  
      // ===== FIGHT buttons =====

  return null;
}

