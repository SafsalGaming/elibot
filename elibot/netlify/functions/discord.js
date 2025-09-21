if (cmd === "daily") {
  // תבחר אם פרטי/פומבי
  await deferEphemeralInteraction(body); // או deferPublicInteraction(body)

  try {
    // מביאים מצב רק בשביל טקסט יפה
    const u = await getUser(userId);
    const base = (u.balance ?? 100);

    const nowISO = new Date().toISOString();
    const cutoffISO = new Date(Date.now() - DAY).toISOString(); // 24h אחורה

    // עדכון א ט ו מ י: יתבצע רק אם last_daily ריק או <= cutoff
    const { data: updated, error } = await SUPABASE
      .from("users")
      .update({
        balance: base + 50,        // אין סכימת SQL, אז משתמשים בבסיס שהבאנו
        last_daily: nowISO,        // נעדכן רק אם התנאי עובר
      })
      .eq("id", userId)
      .or(`last_daily.is.null,last_daily.lte.${cutoffISO}`)
      .select("balance");

    if (error) {
      console.log("daily update error:", error);
      await editOriginal(body, { content: "⚠️ תקלה זמנית. נסה שוב מאוחר יותר." });
      return { statusCode: 200, body: "" };
    }

    // אם לא עודכן כלום – סימן שכבר לקחת ב־24 שעות האחרונות
    if (!updated || updated.length === 0) {
      const last = u.last_daily ? new Date(u.last_daily).getTime() : 0;
      const left = Math.max(0, DAY - (Date.now() - last));
      const h = Math.floor(left / HOUR);
      const m = Math.floor((left % HOUR) / (60 * 1000));
      await editOriginal(body, { content: `⏳ כבר לקחת היום. נסה שוב בעוד ${h} שעות ו-${m} דקות.` });
      return { statusCode: 200, body: "" };
    }

    // הצליח – מחזירים הודעת הצלחה
    const newBalance = updated[0].balance;
    await editOriginal(body, { content: `🎁 קיבלת **50** מטבעות! יתרה חדשה: **${newBalance}**` });
    return { statusCode: 200, body: "" };
  } catch (e) {
    console.log("daily unexpected error:", e);
    await editOriginal(body, { content: "⚠️ תקלה זמנית. נסה שוב מאוחר יותר." });
    return { statusCode: 200, body: "" };
  }
}
