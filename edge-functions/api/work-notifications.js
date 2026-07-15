import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { sendPushToOwner, safePart } from "../_lib/push.js";
import { kv, listJson } from "../_lib/storage.js";

const NOTIFICATION_PREFIX = "work_notice_";
const safeText = (value, max = 2000) => String(value || "").trim().slice(0, max);
const safeLevel = (value) => ["info", "success", "warning", "error"].includes(value) ? value : "info";
const notificationPrefix = (owner) => `${NOTIFICATION_PREFIX}${safePart(owner)}_`;

function workNotificationKey(owner, createdAt, id) {
  return `${notificationPrefix(owner)}${safePart(createdAt)}_${safePart(id)}`;
}

function safeUrl(value) {
  const text = safeText(value, 300);
  if (!text) return "./#other";
  if (/^\.\/#/.test(text) || /^#/.test(text)) return text;
  return "./#other";
}

function makeNotification(owner, input) {
  const title = safeText(input.title, 80);
  if (!title) throw new Error("工作通知需要标题");
  const createdAt = new Date().toISOString();
  const id = `wn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    kind: "work-notification",
    owner,
    title,
    body: safeText(input.body ?? input.message, 2000),
    level: safeLevel(input.level),
    source: safeText(input.source || "codex", 40) || "codex",
    url: safeUrl(input.url),
    createdAt,
    status: "unread",
  };
}

export default async function onRequest({ request, env }) {
  try {
    const store = kv(env);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    if (request.method === "GET") {
      const auth = await requireAuth(request, env, "device");
      const notifications = (await listJson(notificationPrefix(auth.sub), store))
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
        .slice(0, 50);
      return json({ ok: true, notifications });
    }

    if (request.method === "POST" && action === "publish") {
      const auth = await requireAuth(request, env, "codex");
      const input = await readJson(request);
      const notification = makeNotification(auth.sub, input);
      const key = workNotificationKey(auth.sub, notification.createdAt, notification.id);
      await store.put(key, { ...notification, key });
      const pushed = await sendPushToOwner(auth.sub, store, env, {
        title: "青青",
        body: `工作通知：${notification.title}`,
        url: notification.url,
      });
      return json({ ok: true, notification, pushed });
    }

    return errorJson(new Error("方法不支持"), 405);
  } catch (error) {
    return errorJson(error, error.message?.includes("权限") || error.message?.includes("令牌") ? 401 : 400);
  }
}
