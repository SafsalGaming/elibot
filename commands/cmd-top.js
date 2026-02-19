export async function handleTopCommand(ctx) {
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

  if (cmd === "top") {
    await deferPublicInteraction(body); // מציג "Thinking..." ציבורי
  
    try {
      const { data } = await SUPABASE
        .from("users")
        .select("id, balance")
        .order("balance", { ascending: false })
        .limit(10);
  
      if (!data || data.length === 0) {
        await editOriginal(body, { content: `אין עדיין נתונים ללוח הובלות.` });
        return { statusCode: 200, body: "" };
      }
  
      const lines = data.map((u, i) => `**${i + 1}.** <@${u.id}> — ${fmtN(u.balance)} ${eliCoin}`);
  
      await editOriginal(body, {
        embeds: [
          {
            title: "🏆 טופ 10 עשירים",
            description: lines.join("\n"),
            color: 0xf1c40f
          }
        ]
      });
  
      return { statusCode: 200, body: "" };
    } catch (e) {
      console.log("top error:", e?.message || e);
      await editOriginal(body, { content: "⚠️ תקלה זמנית. נסה שוב מאוחר יותר." });
      return { statusCode: 200, body: "" };
    }
  }
  
  
  
     /* ----- roulette amount ----- */

  return null;
}

