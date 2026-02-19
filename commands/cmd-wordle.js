export async function handleWordleCommand(ctx) {
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

  if (cmd === "wordle") {
    await deferPublicInteraction(body);
  
    try {
      const todayYMD = ymdInTZ();
      const todayHeb = ddmmyyyyInTZ();
      const guessRaw = (opts.word || "").toLowerCase().trim();
  
      const { set: wordSet } = await getWordList();
      let game = await getOrCreateWordleGame(userId, todayYMD);
  
      // ללא פרמטר — מצב יומי
  // ללא פרמטר — מצב יומי
  // ללא פרמטר — מצב יומי
  if (!guessRaw) {
    const finished = !!game.finished;
    const history = formatHistoryLines(game.guesses || []);
    const grayLine = summarizeLetters(game.guesses || []);
  
    let description = history || "_עוד אין ניחושים היום_";
    if (!finished && grayLine) description += `\n\n${grayLine}`;
    if (finished) description += `\n\n🏆 סיימת את הוורדל להיום!\nהמילה: **${game.solution.toUpperCase()}**`;
  
    await editOriginal(body, wordleEmbed(todayHeb, description));
    return { statusCode: 200, body: "" };
  }
  
  
  
  
      // גמרת את הניסיונות/סימנת סיום
      if (game.finished || (game.attempts || 0) >= WORDLE_MAX_ATTEMPTS) {
  await editOriginal(body, wordleEmbed(
    todayHeb,
    `❌ סיימת להיום. המילה היתה: **${game.solution.toUpperCase()}**.\nתחכה עד חצות לפי שעון ישראל למשחק חדש.`
  ));
  
        return { statusCode: 200, body: "" };
      }
  
      // בדיקת ולידציה בסיסית — 5 אותיות באנגלית
      if (!isValidGuess(guessRaw)) {
        await editOriginal(body, wordleEmbed(todayHeb, "Invalid word. Use exactly 5 English letters."));
        return { statusCode: 200, body: "" };
      }
      if (!wordSet.has(guessRaw)) {
        await editOriginal(body, wordleEmbed(todayHeb, "Invalid word. Try again."));
        return { statusCode: 200, body: "" };
      }
  
  const { emoji, marks } = scoreWordle(game.solution, guessRaw);
      const attempts = (game.attempts || 0) + 1;
  
  // ניצחון
  if (guessRaw === game.solution.toLowerCase()) {
    const newHistory = [...(game.guesses || []), { word: guessRaw, emoji, marks }];
  
    // נסמן סיום רק אם עוד לא סומן (הגנה ממרוצים)
    const { data: updatedRows, error: finishErr } = await SUPABASE.from("wordle_games")
  .update({
    attempts, finished: true, guesses: newHistory,
    updated_at: ymdhmsInTZ()
  })
      .eq("user_id", userId)
      .eq("date", todayYMD)
      .is("finished", false)
      .select("id");
  
    // אם לא עודכנה שורה (כבר סומן כסיום), נטען מחדש את המשחק ונציג בלי פרס
     let awarded = false;
    let contentSuffix = "";
  
    if (!finishErr && updatedRows && updatedRows.length > 0) {
      // מעניקים פרס על ניצחון: הגבוה מבין 150 או 30% מהיתרה הנוכחית
      const u = await getUser(userId);
      const before = u.balance ?? 100;
      const reward = Math.max(100, Math.floor(before * 0.20));
      const newBal = before + reward;
      await setUser(userId, { balance: newBal });
      awarded = true;
      contentSuffix =
        `\n💰 קיבלת **+${fmtN(reward)}** בוטיאלים על הניצחון!` +
        ` יתרה חדשה: **${fmtN(newBal)}**`;
    }
  
  
  const history = formatHistoryLines(newHistory);
  let description =
    `${history}\n\n` +
    `🏆 סיימת את הוורדל להיום!\n` +
    `המילה: **${game.solution.toUpperCase()}**.` +
    (contentSuffix || ""); // יוסיף שורת פרס אם חולק
  
  await editOriginal(body, wordleEmbed(todayHeb, description));
  
  
    return { statusCode: 200, body: "" };
  }
  
  
  // לא ניצחת — עדכון היסטוריה והמשך
  const newHistory = [...(game.guesses || []), { word: guessRaw, emoji, marks }];
  await SUPABASE.from("wordle_games")
    .update({ attempts, guesses: newHistory, updated_at: ymdhmsInTZ() })
    .eq("user_id", userId)
    .eq("date", todayYMD);
  
  
  if (attempts >= WORDLE_MAX_ATTEMPTS) {
    // הפסד — מציגים את המילה
    const history = formatHistoryLines(newHistory);
    await editOriginal(body, wordleEmbed(
      todayHeb,
      `${history}\n\n❌ זה היה הניסיון השישי. המילה הנכונה: **${game.solution.toUpperCase()}**.`
    ));
  } else {
    // יש עוד ניסיונות — מציגים היסטוריה + רק אותיות אפורות + “נסה שוב”
    const left = WORDLE_MAX_ATTEMPTS - attempts;
    const history = formatHistoryLines(newHistory);
    const grayLine2 = summarizeLetters(newHistory);
  
    let description = history;
    if (grayLine2) description += `\n\n${grayLine2}`;
    description += `\nנסה שוב. נשארו **${left}** ניסיונות.`;
  
    await editOriginal(body, wordleEmbed(todayHeb, description));
  }
  
  
  
      return { statusCode: 200, body: "" };
    } catch (e) {
    console.log("wordle error:", e?.message || e);
    const todayHeb = ddmmyyyyInTZ(); // כדי שיהיה כותרת עם התאריך גם בשגיאה
    await editOriginal(body, wordleEmbed(todayHeb, "⚠️ תקלה זמנית. נסה שוב מאוחר יותר."));
    return { statusCode: 200, body: "" };
  }
  }
  
  /* ----- lottery_updates_role ----- */
  /* ----- lottery_updates_role ----- */

  return null;
}

