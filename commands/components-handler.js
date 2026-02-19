import { handleRoleComponent } from "./component-role.js";
import { handleRouletteComponent } from "./component-roulette.js";
import { handleFightComponent } from "./component-fight.js";

const COMPONENT_HANDLERS = [
  handleRoleComponent,
  handleRouletteComponent,
  handleFightComponent,
];

export async function handleComponentInteraction(body, ctx) {
  if (!(body?.type === 3 && body.data?.component_type === 2)) return null;

  const cid = body.data.custom_id || "";
  const userId   = body.member?.user?.id || body.user?.id;
  const username = body.member?.user?.username || body.user?.username || "חבר";
  const guildId  = body.guild_id;
  const channel  = body.channel_id;

  const componentCtx = {
    ...ctx,
    body,
    cid,
    userId,
    username,
    guildId,
    channel,
  };

  for (const handler of COMPONENT_HANDLERS) {
    const response = await handler(componentCtx);
    if (response) return response;
  }

  return ctx.json({ type: 7, data: { content: "❓ פעולה לא מוכרת.", components: [] } });
}

