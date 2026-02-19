export async function handleLotteryUpdatesRoleCommand(ctx) {
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

  if (cmd === "lottery_updates_role") {
    await deferPublicInteraction(body); // אם תרצה אפמרלי: החלף ל-deferEphemeralInteraction
  
    const guildId = body.guild_id;
    if (!guildId) {
      await editOriginal(body, { content: "❌ הפקודה זמינה רק בשרת." });
      return { statusCode: 200, body: "" };
    }
  
    const already = (body.member?.roles || []).includes(UPDATES_ROLE_ID);
  
    try {
      if (already) {
        // אם יש למשתמש את הרול – נוריד
        const r = await fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${UPDATES_ROLE_ID}`, {
          method: "DELETE",
          headers: BOT_HEADERS,
        });
        if (!r.ok) throw new Error(`removeRole ${r.status}: ${await r.text()}`);
  
        await editOriginal(body, { content: "❌ הסרתי לך את רול העדכונים" });
        return { statusCode: 200, body: "" };
      } else {
        // אם אין – נוסיף
        await addRoleToMember(guildId, userId, UPDATES_ROLE_ID);
  
        await editOriginal(body, { content: "✅ קיבלת את רול העדכונים 📢" });
        return { statusCode: 200, body: "" };
      }
    } catch (e) {
      console.log("updates_role error:", e?.message || e);
      await editOriginal(body, {
        content: "⚠️ לא הצלחתי לשנות את הרול. ודא שלבוט יש Manage Roles והרול מתחת לרול של הבוט."
      });
      return { statusCode: 200, body: "" };
    }
  }

  return null;
}

