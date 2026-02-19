export async function handleFightComponent(ctx) {
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

      if (cid.startsWith("fight_join:")) {
        const [, creatorId, amountStr] = cid.split(":");
        const amount = parseInt(amountStr, 10);
  
        if (userId === creatorId) {
          return json({ type: 4, data: { flags: 64, content: `❌ לא ניתן להצטרף לקרב של עצמך.` } });
        }
  
        const a = await getUser(creatorId);
        const b = await getUser(userId);
        if ((a.balance ?? 100) < amount) {
          return json({ type: 4, data: { flags: 64, content: `❌ <@${creatorId}> אין מספיק בוטיאלים כדי לקיים את הקרב כרגע.` } });
        }
        if ((b.balance ?? 100) < amount) {
          return json({ type: 4, data: { flags: 64, content: `❌ אין לך מספיק בוטיאלים להצטרפות (נדרש ${fmtN(amount)}).` } });
        }
  
        await setUser(creatorId, { balance: (a.balance ?? 100) - amount });
        await setUser(userId,     { balance: (b.balance ?? 100) - amount });
  
        const winner = Math.random() < 0.5 ? creatorId : userId;
        const w = await getUser(winner);
        const prize = amount * 2;
        await setUser(winner, { balance: (w.balance ?? 100) + prize });
  
        return json({
          type: 7,
          data: {
            content:
              `🥊 קרב על **${fmtN(amount)}**! המשתתפים: <@${creatorId}> מול <@${userId}>.\n` +
              `🏆 הזוכה: <@${winner}> וקיבל **${fmtN(prize)}** בוטיאלים.`,
            components: []
          }
        });
      }
  
      if (cid.startsWith("fight_cancel:")) {
        const [, creatorId, amountStr] = cid.split(":");
        const amount = parseInt(amountStr, 10);
  
        if (userId !== creatorId) {
          return json({ type: 4, data: { flags: 64, content: `❌ רק יוצר הקרב יכול לבטל אותו.` } });
        }
  
        return json({
          type: 7,
          data: {
            content: `🥊 הקרב על **${fmtN(amount)}** בוטל על ידי <@${creatorId}>.`,
            components: []
          }
        });
      }
  
      return json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });

  return null;
}

