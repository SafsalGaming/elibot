import { fetch } from "undici";
import { handleWordleCommand } from "./cmd-wordle.js";
import { handleLotteryUpdatesRoleCommand } from "./cmd-lottery-updates-role.js";
import { handleBalanceCommand } from "./cmd-balance.js";
import { handleWorkCommand } from "./cmd-work.js";
import { handleCoinflipCommand } from "./cmd-coinflip.js";
import { handleDailyCommand } from "./cmd-daily.js";
import { handleDiceCommand } from "./cmd-dice.js";
import { handleGiveCommand } from "./cmd-give.js";
import { handleTopCommand } from "./cmd-top.js";
import { handleRouletteCommand } from "./cmd-roulette.js";
import { handleFightCommand } from "./cmd-fight.js";
import { handleLotteryCommand } from "./cmd-lottery.js";

const COMMAND_HANDLERS = [
  handleWordleCommand,
  handleLotteryUpdatesRoleCommand,
  handleBalanceCommand,
  handleWorkCommand,
  handleCoinflipCommand,
  handleDailyCommand,
  handleDiceCommand,
  handleGiveCommand,
  handleTopCommand,
  handleRouletteCommand,
  handleFightCommand,
  handleLotteryCommand,
];

export async function handleSlashCommand(body, ctx) {
  const { json, ensureUsernameOnce, GAMBLING_CMDS, ALLOWED_GAMBLING_CHANNEL } = ctx;

  if (body?.type !== 2) return null;

  const cmd  = body.data.name;
  const opts = Object.fromEntries((body.data.options || []).map((o) => [o.name, o.value]));
  const userId   = body.member?.user?.id || body.user?.id;
  const username = body.member?.user?.username || body.user?.username || "חבר";
  const display  = body.member?.nick || body.member?.user?.global_name || body.user?.global_name || username;
  const channelId = body.channel_id;

  await ensureUsernameOnce(userId, display);

  // הגבלת ערוץ להימורים (לוטו מותר בכל ערוץ)
  if (GAMBLING_CMDS.has(cmd) && channelId && channelId !== ALLOWED_GAMBLING_CHANNEL) {
    return json({ type: 4, data: { content: `🎲 הימורים רק בחדר <#${ALLOWED_GAMBLING_CHANNEL}>` } });
  }

  const commandCtx = {
    ...ctx,
    fetch,
    body,
    cmd,
    opts,
    userId,
    username,
    display,
    channelId,
  };

  for (const handler of COMMAND_HANDLERS) {
    const response = await handler(commandCtx);
    if (response) return response;
  }

  return json({ type: 4, data: { content: `הפקודה לא מוכרת.` } });
}

