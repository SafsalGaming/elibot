export async function handleGiveCommand(ctx) {
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

  if (cmd === "give") {
    await deferPublicInteraction(body);
  
    try {
      const target = opts.user;
      const amount = parseInt(opts.amount, 10);
  
      if (!target || target === userId) {
        await editOriginal(body, { content: `❌ משתמש לא תקין.` });
        return { statusCode: 200, body: "" };
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום לא תקין.` });
        return { statusCode: 200, body: "" };
      }
  
      const u = await getUser(userId);
      const giverBal = u.balance ?? 100;
      if (giverBal < amount) {
        await editOriginal(body, { content: `❌ אין לך מספיק בוטיאלים. היתרה: ${fmtN(giverBal)}.` });
        return { statusCode: 200, body: "" };
      }
  
      const receiver = await getUser(target);
      const receiverBal = receiver.balance ?? 100;
  
      // עדכון יתרות
      await setUser(userId, { balance: giverBal - amount });
      await setUser(target,  { balance: receiverBal + amount });
  
      await editOriginal(body, {
        content: `🤝 העברת **${fmtN(amount)}** ל־<@${target}>. היתרה שלך: **${fmtN(giverBal - amount)}**, שלו: **${fmtN(receiverBal + amount)}**`
      });
      return { statusCode: 200, body: "" };
    } catch (e) {
      console.log("give error:", e);
      await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
      return { statusCode: 200, body: "" };
    }
  }
  
      /* ----- top ----- */

  return null;
}

