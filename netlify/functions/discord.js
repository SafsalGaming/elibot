import { readFile } from "node:fs/promises";
import { handleDiscordEvent } from "../../commands/discord-handler.js";

const WORD_LIST_PATH = new URL("../../api/words.json", import.meta.url);
let cachedWordList = null;

async function getWordList() {
  if (cachedWordList) return cachedWordList;

  const text = await readFile(WORD_LIST_PATH, "utf8");
  const list = JSON.parse(text)
    .map((w) => String(w).trim().toLowerCase())
    .filter((w) => w.length === 5 && /^[a-z]{5}$/.test(w));

  const set = new Set(list);
  cachedWordList = { list, set };
  return cachedWordList;
}

export async function handler(event) {
  return handleDiscordEvent(event, { getWordList });
}
