export async function handleRouletteCommand(ctx) {
  const {
    cmd,
    body,
    opts,
    userId,
    username,
    display,
    channelId,
    json,
    ensureUsernameOnce,
    GAMBLING_CMDS,
    ALLOWED_GAMBLING_CHANNEL,
    deferPublicInteraction,
    deferEphemeralInteraction,
    ymdInTZ,
    ddmmyyyyInTZ,
    getWordList,
    getOrCreateWordleGame,
    formatHistoryLines,
    summarizeLetters,
    wordleEmbed,
    editOriginal,
    WORDLE_MAX_ATTEMPTS,
    isValidGuess,
    scoreWordle,
    SUPABASE,
    ymdhmsInTZ,
    getUser,
    setUser,
    fmtN,
    UPDATES_ROLE_ID,
    API,
    BOT_HEADERS,
    addRoleToMember,
    toMsILLocal,
    fmtReadyIL,
    nowILString,
    WORDLE_TZ,
    DICE_USER_WIN_P,
    DICE_TIE_P,
    COIN_USER_WIN_P,
    eliCoin,
    rouletteBustChance,
    rouletteCompoundedMultiplier,
    row,
    btn,
    postChannelMessage,
    lotteryWinnerEmbed,
    LOTTERY_CHANNEL_ID,
    randomUUID,
    editOrPostLotteryMessage,
    lotteryOpenEmbed,
    fetch,
  } = ctx;

  if (cmd === "roulette") {
    await deferPublicInteraction(body);
  
    const amount = parseInt(opts.amount, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
      return { statusCode: 200, body: "" };
    }
  
    const u = await getUser(userId);
    if ((u.balance ?? 100) < amount) {
  await editOriginal(body, { content: `Not enough balance. You have ${fmtN(u.balance ?? 100)}.` });
      return { statusCode: 200, body: "" };
    }
  
    // מחייבים את המשתמש על ההימור
    await setUser(userId, { balance: (u.balance ?? 100) - amount });
  
    // 🔥 בדיקת BUST לסיבוב 1 (5%)
    const immediateBust = Math.random() < rouletteBustChance(1);
    if (immediateBust) {
      await editOriginal(body, {
        content: `🎰 **BUST!** הפסדת (${fmtN(amount)}).`,
        components: [] // נטרל כפתורים אם היו
      });
      return { statusCode: 200, body: "" };
    }
  
    // אם שרדנו את סיבוב 1 – מציגים Round 1 עם מכפיל 1.1
    const round = 1;
    const payout = Math.floor(amount * rouletteCompoundedMultiplier(round));
    const nextBustPct = Math.round(rouletteBustChance(round + 1) * 100);
  
    await editOriginal(body, {
      content: `🎰 רולטה — סיבוב ${round} · סכום נוכחי: **${fmtN(payout)}** (סיכוי פיצוץ הבא: ${nextBustPct}%)`,
      components: [
        row([
          btn(`roulette:${userId}:${amount}:${round}:hit`,  "המשך", 3),
          btn(`roulette:${userId}:${amount}:${round}:cash`, "צא",    4),
        ])
      ]
    });
    return { statusCode: 200, body: "" };
  }
  
  
      /* ----- fight amount ----- */
     /* ----- fight amount ----- */

  return null;
}

