import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { feedbackKey, feedbackPrefix, validateFeedback } from "../_lib/feedback.js";
import { kv, listJson } from "../_lib/storage.js";

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env, "device");
    const store = kv(env);
    if (request.method === "GET") {
      const date = new URL(request.url).searchParams.get("date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("反馈日期无效");
      const items = (await listJson(feedbackPrefix(owner.sub), store))
        .filter((item) => item.date === date && (item.kind === "task-plan" || item.kind === "task-result"))
        .sort((a, b) => String(a.completedAt || a.updatedAt || a.receivedAt || a.createdAt || "").localeCompare(String(b.completedAt || b.updatedAt || b.receivedAt || b.createdAt || "")));
      return json({ ok: true, items });
    }
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const feedback = validateFeedback(await readJson(request));
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
