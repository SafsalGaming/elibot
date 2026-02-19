export async function handleCoinflipCommand(ctx) {
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

  if (cmd === "coinflip") {
    await deferPublicInteraction(body);
  
    try {
      const choice = String(opts.choice || "").toLowerCase();
      const amount = parseInt(opts.amount, 10);
  
      if (!["heads", "tails"].includes(choice)) {
        await editOriginal(body, { content: `❌ בחירה לא תקינה. בחר heads או tails.` });
        return { statusCode: 200, body: "" };
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
        return { statusCode: 200, body: "" };
      }
  
      const u = await getUser(userId);
      if (amount > (u.balance ?? 100)) {
  await editOriginal(body, { content: `Not enough balance. You have ${fmtN(u.balance ?? 100)}.` });
        return { statusCode: 200, body: "" };
      }
  
  // קובעים מראש האם המשתמש ניצח בהטלה הזו (55%)
  const won = Math.random() < COIN_USER_WIN_P;
  // מייצרים "תוצאת מטבע" עקבית עם התוצאה
  const flip = won ? choice : (choice === "heads" ? "tails" : "heads");
  
  const balance = (u.balance ?? 100) + (won ? amount : -amount);
  
  await setUser(userId, { balance });
  await editOriginal(body, {
    content: `🪙 יצא **${flip}** — ${won ? `זכית! +${fmtN(amount)}` : `הפסדת... -${fmtN(amount)}`} | יתרה: **${fmtN(balance)}**`
  });
  
      return { statusCode: 200, body: "" };
    } catch (e) {
      console.log("coinflip error:", e);
      await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
      return { statusCode: 200, body: "" };
    }
  }
  
  
      /* ----- daily (+50 / 24h) ----- */
     /* ----- daily (+50 / 24h) ----- */
  /* ----- daily (max of +50 or 10%) / 24h ----- */

  return null;
}

