export async function handleRoleComponent(ctx) {
  const {
    body,
    cid,
    userId,
    username,
    guildId,
    channel,
    json,
    addRoleToMember,
    ROLE_BUTTON_ENFORCE_CHANNEL,
    ROLE_BUTTON_ENFORCE_MESSAGE,
    rouletteBustChance,
    rouletteCompoundedMultiplier,
    fmtN,
    row,
    btn,
    getUser,
    setUser,
  } = ctx;

      if (cid.startsWith("role:")) {
        const roleId = cid.split(":")[1];
        if (!roleId) return json({ type: 4, data: { flags: 64, content: "❌ שגיאת רול." } });
  
        // הגבלות לפי ערוץ/הודעה (אופציונלי)
        if (ROLE_BUTTON_ENFORCE_CHANNEL && channel !== ROLE_BUTTON_ENFORCE_CHANNEL) {
          return json({ type: 4, data: { flags: 64, content: "❌ לא ניתן להשתמש בכפתור הזה כאן." } });
        }
        if (ROLE_BUTTON_ENFORCE_MESSAGE && body.message?.id !== ROLE_BUTTON_ENFORCE_MESSAGE) {
          return json({ type: 4, data: { flags: 64, content: "❌ לא ניתן להשתמש בכפתור הזה בהודעה הזו." } });
        }
  
        // אם כבר יש למשתמש את הרול — נחזיר הודעה קצרה
        const hasRole = (body.member?.roles || []).includes(roleId);
        if (hasRole) {
          return json({ type: 4, data: { flags: 64, content: `✅ כבר יש לך את הרול.` } });
        }
  
        try {
          await addRoleToMember(guildId, userId, roleId);
          return json({ type: 4, data: { flags: 64, content: `✅ הרול נוסף בהצלחה!` } });
        } catch (e) {
          console.log("addRole error:", e?.message || e);
          return json({ type: 4, data: { flags: 64, content: `⚠️ לא ניתן להוסיף את הרול כרגע.` } });
        }
      }
  
  // ===== ROULETTE buttons =====
  // custom_id: "roulette:ownerId:bet:round:action"

  return null;
}

