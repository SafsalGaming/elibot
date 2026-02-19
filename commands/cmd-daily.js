export async function handleDailyCommand(ctx) {
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

  if (cmd === "daily") {
    await deferPublicInteraction(body);
  
    try {
      const now = Date.now();
      const today = ymdInTZ(now, WORDLE_TZ); // YYYY-MM-DD לפי שעון ישראל
      const u = await getUser(userId);
  
      // נחלץ YMD של הפעם הקודמת (תומך גם בתאריך-טקסט וגם ב-ISO/timestamp)
      let lastYMD = null;
      if (u.last_daily) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(u.last_daily)) {
          // נשמר כתאריך-טקסט (YYYY-MM-DD)
          lastYMD = u.last_daily;
        } else {
          // נשמר בעבר כ-timestamp/ISO — נמיר ל-YMD לפי ישראל
          const t = new Date(u.last_daily).getTime();
          if (!Number.isNaN(t)) lastYMD = ymdInTZ(t, WORDLE_TZ);
        }
      }
  
      // אם כבר נאסף היום — נחסום
      if (lastYMD === today) {
        await editOriginal(body, { content: `⏳ כבר לקחת היום. תחזור מחר.` });
        return { statusCode: 200, body: "" };
      }
  
      // תגמול: הגבוה מבין 50 או 10% מהיתרה
      const before = u.balance ?? 100;
      const reward = Math.max(50, Math.floor(before * 0.10));
      const balance = before + reward;
  
      // נשמור timestamp (וגם אם העמודה היא טקסט/טיימסטמפ זה יעבוד; ההשוואה תמיד נעשית לפי YMD)
  // היה: await setUser(userId, { balance, last_daily: new Date(now).toISOString() });
  await setUser(userId, { balance, last_daily: ymdInTZ(now, WORDLE_TZ) }); // למשל "2025-02-03"
  
      await editOriginal(body, { content: `🎁 קיבלת **${fmtN(reward)}** בוטיאלים! יתרה חדשה: **${fmtN(balance)}**` });
      return { statusCode: 200, body: "" };
    } catch (e) {
      console.log("daily error:", e);
      await editOriginal(body, { content: "⚠️ תקלה זמנית. נסה שוב מאוחר יותר." });
      return { statusCode: 200, body: "" };
    }
  }
  
  
      /* ----- dice amount (d6 vs bot) ----- */
  /* ----- dice amount (d6 vs bot) ----- */

  return null;
}

