export async function handleDiceCommand(ctx) {
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

  if (cmd === "dice") {
    await deferPublicInteraction(body);
  
    try {
      const amount = parseInt(opts.amount, 10);
      if (!Number.isInteger(amount) || amount <= 0) {
        await editOriginal(body, { content: `❌ סכום הימור לא תקין.` });
        return { statusCode: 200, body: "" };
      }
  
      // נוודא למשתמש רשומה ונביא יתרה
      const u0 = await getUser(userId);
      let balance = u0?.balance ?? 100;
  
      if (balance < amount) {
        await editOriginal(body, { content: `${username}, אין לך מספיק בוטיאלים 🎲 (יתרה: ${fmtN(balance)})` });
        return { statusCode: 200, body: "" };
      }
  
  
  let userRoll, botRoll;
  const r = Math.random();
  
  if (r < DICE_USER_WIN_P) {
    // ניצחון למשתמש: בוחרים זוג עם user > bot
    // בוחרים bot 1..5 ואז user בטווח (bot+1..6)
    botRoll  = 1 + Math.floor(Math.random() * 5);
    userRoll = botRoll + 1 + Math.floor(Math.random() * (6 - botRoll));
  } else if (r < DICE_USER_WIN_P + DICE_TIE_P) {
    // תיקו: אותו מספר
    userRoll = botRoll = 1 + Math.floor(Math.random() * 6);
  } else {
    // הפסד למשתמש: user < bot
    userRoll = 1 + Math.floor(Math.random() * 5);
    botRoll  = userRoll + 1 + Math.floor(Math.random() * (6 - userRoll));
  }
  
      if (userRoll > botRoll) {
        balance += amount;
        await setUser(userId, { balance });
        await editOriginal(body, { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — ניצחת! +${fmtN(amount)}. יתרה: **${fmtN(balance)}**` });
      } else if (userRoll < botRoll) {
        balance -= amount;
        await setUser(userId, { balance });
        await editOriginal(body, { content: `🎲 אתה: **${userRoll}**, אלי: **${botRoll}** — עוד ניצחון לאלי -${fmtN(amount)}. יתרה: **${fmtN(balance)}**` });
      } else {
        await editOriginal(body, { content: `🎲 תיקו! אתה: **${userRoll}**, אלי: **${botRoll}** — אין שינוי (יתרה: ${fmtN(balance)})` });
      }
  
      return { statusCode: 200, body: "" };
    } catch (e) {
      console.log("dice error:", e);
      await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
      return { statusCode: 200, body: "" };
    }
  }
  
  
   /* ----- give user amount ----- */

  return null;
}

