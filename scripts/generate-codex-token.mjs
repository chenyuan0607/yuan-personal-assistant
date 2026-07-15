import { issueToken } from "../edge-functions/_lib/crypto.js";

if (!process.env.SESSION_SECRET) throw new Error("缺少 SESSION_SECRET");
const now = Math.floor(Date.now() / 1000);
const token = await issueToken({ sub: "owner", kind: "codex", exp: now + 365 * 86400 }, process.env.SESSION_SECRET, now);
process.stdout.write(`${token}\n`);
