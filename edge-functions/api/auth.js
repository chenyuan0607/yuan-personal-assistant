import { issueToken, sha256, verifyToken } from "../_lib/crypto.js";
import { errorJson, json, readJson } from "../_lib/http.js";

export default async function onRequest({ request, env }) {
  try {
    if (request.method === "POST") {
      const { accessCode, deviceName = "手机" } = await readJson(request);
      if (await sha256(accessCode) !== env.OWNER_ACCESS_CODE_HASH) return errorJson(new Error("访问码错误"), 401);
      const now = Math.floor(Date.now() / 1000);
      const token = await issueToken({ sub: "owner", kind: "device", deviceName, exp: now + 90 * 86400 }, env.SESSION_SECRET, now);
      return json({ ok: true, token, expiresInDays: 90 });
    }
    if (request.method === "DELETE") return json({ ok: true });
    return errorJson(new Error("方法不支持"), 405);
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function requireAuth(request, env, kind = "device") {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (payload.kind !== kind) throw new Error("权限不足");
  return payload;
}
