export async function handleLotteryCommand(ctx) {
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

      if (cmd === "lottery") {
        const amount = parseInt(opts.amount, 10);
        if (!Number.isInteger(amount) || amount <= 0) {
          // שגיאה מיד — אפמרלי קצר, בלי defer
          return json({ type: 4, data: { flags: 64, content: "❌ סכום לא תקין." } });
        }
  
  await deferPublicInteraction(body);
  // לא מוחקים יותר את ההודעה
  
  
        try {
          // 1) אם יש הגרלה פתוחה שפג זמנה — נסגור, נכריז זוכה בהודעה נפרדת, ונסמן סגורה
          const nowMs = Date.now();
          let { data: lot } = await SUPABASE
            .from("lotteries")
            .select("id,status,is_open,created_at,close_at,message_id,number,channel_id")
            .eq("status","open")
            .eq("is_open", true)
            .maybeSingle();
  
          let createdNew = false;
  
          if (lot && lot.created_at) {
            const createdMs = new Date(lot.created_at).getTime();
            if (Number.isFinite(createdMs) && (nowMs - createdMs) >= 24 * 60 * 60 * 1000) {
              const { data: rows } = await SUPABASE
                .from("lottery_entries")
                .select("user_id,amount")
                .eq("lottery_id", lot.id);
  
              const totalPast = (rows || []).reduce((s, r) => s + r.amount, 0);
  
              if (totalPast > 0 && rows?.length) {
                let roll = Math.random() * totalPast;
                let winner = rows[0].user_id;
                for (const r of rows) { roll -= r.amount; if (roll <= 0) { winner = r.user_id; break; } }
  
                const w = await getUser(winner);
                await setUser(winner, { balance: (w.balance ?? 100) + totalPast });
  
                // הכרזה חדשה ונפרדת (לא עורכים את הודעת הלוטו המקורית)
                await postChannelMessage(lot.channel_id || LOTTERY_CHANNEL_ID, {
                  content: `<@${winner}>`,
                  ...lotteryWinnerEmbed(lot.number, winner, totalPast)
                });
              }
              await SUPABASE.from("lotteries").update({
                status: "closed",
                is_open: false,
                closed_at: ymdhmsInTZ()
              }).eq("id", lot.id);
              lot = null;
            }
          }
  
          // 2) בדיקת יתרה
          const u = await getUser(userId);
          if ((u.balance ?? 100) < amount) {
            await editOriginal(body, { content: `Not enough balance. You have ${fmtN(u.balance ?? 100)}.` });
            return { statusCode: 200, body: "" };
          }
  
          // 3) לוקחים/פותחים הגרלה פתוחה
          if (lot) {
            // ודא ש-close_at = created_at + 24h
            const targetClose = ymdhmsInTZ(new Date(lot.created_at).getTime() + 24*60*60*1000, WORDLE_TZ);
            if (!lot.close_at || Math.abs(new Date(lot.close_at).getTime() - new Date(targetClose).getTime()) > 2000) {
              await SUPABASE.from("lotteries").update({ close_at: targetClose }).eq("id", lot.id);
              lot.close_at = targetClose;
            }
          } else {
            // אין הגרלה פתוחה - יוצרים חדשה בהתאם לסכימה עם NOT NULL
            const createdAtIL = ymdhmsInTZ(nowMs, WORDLE_TZ);
            const closeAtIL   = ymdhmsInTZ(nowMs + 24*60*60*1000, WORDLE_TZ);
  
            // מספר רץ
            const { data: lastNumRow } = await SUPABASE
              .from("lotteries")
              .select("number")
              .order("number", { ascending: false })
              .limit(1)
              .maybeSingle();
            const nextNumber = ((lastNumRow?.number) || 0) + 1;
  
            const newId = randomUUID();
            const insertRow = {
              id: newId,
              channel_id: LOTTERY_CHANNEL_ID,
              created_at: createdAtIL,
              closed_at: null,
              close_at: closeAtIL,
              total: 0,
              status: "open",
              number: nextNumber,
              is_open: true,
              message_id: null
            };
  
            const { data: newLot, error: insErr } = await SUPABASE
              .from("lotteries")
              .insert(insertRow)
              .select()
              .single();
            if (insErr) {
              console.log("lottery insert error:", insErr);
              await postChannelMessage(channelId, { content: `<@${userId}> Failed to open a new lottery.` });
              return { statusCode: 200, body: "" };
            }
            lot = newLot;
            createdNew = true;
          }
          // 4) האם זה המשתתף/הראשון לפני ההוספה
          const { count: beforeCount } = await SUPABASE
            .from("lottery_entries")
            .select("id", { count: "exact", head: true })
            .eq("lottery_id", lot.id);
          const wasFirst = createdNew || (beforeCount || 0) === 0;
  
          // 5) חיוב המשתמש
          await setUser(userId, { balance: (u.balance ?? 100) - amount });
  
          // 6) הוספה/עדכון כניסה
          const { data: existing } = await SUPABASE
            .from("lottery_entries")
            .select("id,amount")
            .eq("lottery_id", lot.id)
            .eq("user_id", userId)
            .maybeSingle();
  
          if (existing) {
            await SUPABASE.from("lottery_entries")
              .update({ amount: existing.amount + amount })
              .eq("id", existing.id);
          } else {
            await SUPABASE.from("lottery_entries")
              .insert({ id: randomUUID(), lottery_id: lot.id, user_id: userId, amount, inserted_at: ymdhmsInTZ() });
          }
  
          // 7) עדכון הודעת הלוטו בערוץ הייעודי
          const { data: entries } = await SUPABASE
            .from("lottery_entries")
            .select("user_id,amount")
            .eq("lottery_id", lot.id);
  
          const total = (entries || []).reduce((s, e) => s + e.amount, 0);
          const sums = new Map();
          for (const e of entries || []) sums.set(e.user_id, (sums.get(e.user_id) || 0) + e.amount);
  
          const lines = [];
          for (const [uid, amt] of sums) {
            const pct = total ? Math.round((amt / total) * 100) : 100;
            lines.push(`<@${uid}> → ${pct}%`);
          }
  
          await editOrPostLotteryMessage(
            lot,
            lotteryOpenEmbed(lot.number, lot.created_at, lot.close_at, total, lines)
          );
  
          const confirmText = wasFirst
    ? `<@${userId}> פתח את הגרלה מספר #${lot.number} עם סכום של **${fmtN(amount)}** בוטיאלים 💰`
    : `<@${userId}> הוסיף **${fmtN(amount)}** בוטיאלים להגרלה 💰`;
  
  await editOriginal(body, { content: confirmText });
  
  
          // 8) אישור פומבי/פרטי לפי מה שכבר עובד אצלך (כרגע לא שולחים הודעה נוספת כאן)
          // אם תרצה - כאן אפשר לעשות editOriginal(...) עם אישור, אבל לא משנים טקסטים קיימים.
  
          return { statusCode: 200, body: "" };
        } catch (e) {
          console.log("lottery error:", e?.message || e);
          await editOriginal(body, { content: `⚠️ תקלה זמנית בעיבוד ההגרלה. נסה/י שוב.` });
  return { statusCode: 200, body: "" };
  
        }
      }

  return null;
}

