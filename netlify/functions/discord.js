import { WORDLE_ANSWERS } from "./wordle-words.js";
import { handleDiscordEvent } from "../../commands/discord-handler.js";

let cachedWordList = null;

async function getWordList() {
  if (cachedWordList) return cachedWordList;

  const list = WORDLE_ANSWERS
    .map((w) => String(w).trim().toLowerCase())
    .filter((w) => w.length === 5 && /^[a-z]{5}$/.test(w));

  const set = new Set(list);
  cachedWordList = { list, set };
  return cachedWordList;
}

export async function handler(event) {
  return handleDiscordEvent(event, { getWordList });
}
