export async function handleFightCommand(ctx) {
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

  if (cmd === "fight") {
    await deferPublicInteraction(body); // שולח ACK ציבורי ("thinking...")
  
    const amount = parseInt(opts.amount, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      await editOriginal(body, { content: "❌ סכום לא תקין." });
      return { statusCode: 200, body: "" };
    }
  
    await editOriginal(body, {
      content:
        `🥊 <@${userId}> מזמין לקרב על **${fmtN(amount)}**. ` +
        `לחצו **Join** כדי להצטרף — הזוכה יקבל **${fmtN(amount * 2)}**.\n` +
        `> רק המכריז יכול ללחוץ **Cancel**.`,
      components: [
        row([
          btn(`fight_join:${userId}:${amount}`, "Join", 1),
          btn(`fight_cancel:${userId}:${amount}`, "Cancel", 4),
        ])
      ]
    });
  
    return { statusCode: 200, body: "" };
  }
  
  
      /* ----- LOTTERY ----- */

  return null;
}

