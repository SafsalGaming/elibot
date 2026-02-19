import { readFile } from "node:fs/promises";
import { handleDiscordEvent } from "../commands/discord-handler.js";

const WORD_LIST_PATH = new URL("./words.json", import.meta.url);
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

export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const raw = await readRawBody(req);
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body: raw.toString("utf8"),
    isBase64Encoded: false,
  };

  const result = await handleDiscordEvent(event, { getWordList });
  if (!result) {
    res.status(200).send("");
    return;
  }

  const status = result.statusCode ?? 200;
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(status).send(result.body ?? "");
}
