import { randomBytes, randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { issueToken, sha256 } from "../edge-functions/_lib/crypto.js";

export async function createAssistantSecrets({ nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const accessCode = String(randomInt(0, 10_000_000_000)).padStart(10, "0");
  const sessionSecret = randomBytes(32).toString("base64url");
  return {
    accessCode,
    accessCodeHash: await sha256(accessCode),
    sessionSecret,
    codexToken: await issueToken({ sub: "owner", kind: "codex", exp: nowSeconds + 365 * 86400 }, sessionSecret, nowSeconds),
    createdAt: new Date(nowSeconds * 1000).toISOString(),
  };
}

export async function writeAssistantSecrets(path = join(process.cwd(), ".assistant-secrets", "edgeone.json")) {
  const secrets = await createAssistantSecrets();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(secrets, null, 2), { encoding: "utf8", mode: 0o600 });
  return path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeAssistantSecrets()
    .then((path) => console.log(`本地密钥已保存：${path}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
