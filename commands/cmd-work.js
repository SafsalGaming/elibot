export async function handleWorkCommand(ctx) {
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

  if (cmd === "work") {
    await deferPublicInteraction(body);
  
    try {
      const nowMs = Date.now();                // IL-local clock (בזכות process.env.TZ)
      const u = await getUser(userId);
  
      // קורא מהמסד ומפרש *כמו ישראל* גם אם נשמר עם +00/+03/Z בעבר
      const lastMs = toMsILLocal(u.last_work);
  
      // קולדאון שעה — הכל לפי ישראל (הפרש millis רגיל)
      const HOUR = 60 * 60 * 1000;
      const left = Math.max(0, HOUR - (nowMs - lastMs));
  
      if (left > 0) {
        const m = Math.floor(left / 60000);
        const s = Math.floor((left % 60000) / 1000);
        const readyAtIL = fmtReadyIL(lastMs + HOUR);
        await editOriginal(body, {
          content: `⏳ עבדת לא מזמן. נסה שוב בעוד ${m} דק׳ ו־${s} שניות.`
        });
        return { statusCode: 200, body: "" };
      }
  
      // מותר לעבוד — תגמול
      const before  = u.balance ?? 100;
      const reward  = Math.max(10, Math.floor(before * 0.02));
      const balance = before + reward;
  
      // שומרים למסד *כשעה ישראלית ללא אופסט/Z* כדי שתמיד יפורש נכון
      await setUser(userId, { balance, last_work: nowILString() });
  
      await editOriginal(body, {
        content: `👷 קיבלת **${fmtN(reward)}** בוטיאלים על עבודה. יתרה: **${fmtN(balance)}**`
      });
      return { statusCode: 200, body: "" };
    } catch (e) {
      console.log("work error:", e);
      await editOriginal(body, { content: `⚠️ תקלה זמנית. נסה שוב מאוחר יותר.` });
      return { statusCode: 200, body: "" };
    }
  }
  
      /* ----- coinflip choice amount ----- */

  return null;
}

