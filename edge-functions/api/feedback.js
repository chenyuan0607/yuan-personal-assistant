import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { feedbackKey, validateFeedback } from "../_lib/feedback.js";
import { kv } from "../_lib/storage.js";

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env, "device");
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const feedback = validateFeedback(await readJson(request));
    const store = kv(env);
    const key = feedbackKey(owner.sub, feedback.kind, feedback.date, feedback.id);
    const existing = await store.get(key, { type: "json" });
    const now = new Date().toISOString();
    const record = { ...feedback, status: "waiting", createdAt: existing?.createdAt ?? now, receivedAt: now };
    await store.put(key, JSON.stringify(record));
    return json({ ok: true, record });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
