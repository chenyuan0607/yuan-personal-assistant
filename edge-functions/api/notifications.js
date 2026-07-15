import webpush from "web-push";

import { requireAuth } from "./auth.js";
import { sha256 } from "../_lib/crypto.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { kv, listJson } from "../_lib/storage.js";

const PUSH_PREFIX = "push_";
const DEFAULT_SUBJECT = "mailto:qingqing@example.invalid";

const safePart = (value) => String(value || "").replace(/[^A-Za-z0-9_]/g, "_");
const pushPrefix = (owner) => `${PUSH_PREFIX}${safePart(owner)}_`;

async function pushKey(owner, endpoint) {
  return `${pushPrefix(owner)}${safePart(await sha256(endpoint))}`;
}

function validateSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") throw new Error("推送订阅无效");
  if (!/^https:\/\//.test(String(subscription.endpoint || ""))) throw new Error("推送地址无效");
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error("推送密钥不完整");
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  };
}

function configureWebPush(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error("主动通知还没有配置推送密钥");
  const sender = env.WEB_PUSH_IMPL || webpush;
  sender.setVapidDetails(env.VAPID_SUBJECT || DEFAULT_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return sender;
}

function isExpiredPushError(error) {
  return error?.statusCode === 404 || error?.statusCode === 410;
}

async function sendTestNotifications(owner, store, env) {
  const sender = configureWebPush(env);
  const records = await listJson(pushPrefix(owner), store);
  let sent = 0;
  let removed = 0;
  const payload = JSON.stringify({
    title: "青青",
    body: "主动通知已经打开啦。",
    url: "./#assistant",
  });
  for (const record of records) {
    try {
      await sender.sendNotification(record.subscription, payload);
      sent += 1;
    } catch (error) {
      if (!isExpiredPushError(error)) throw error;
      await store.delete(record.key);
      removed += 1;
    }
  }
  return { sent, removed };
}

export default async function onRequest({ request, env }) {
  try {
    const auth = await requireAuth(request, env, "device");
    const store = kv(env);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    if (request.method === "GET") {
      return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY || "" });
    }

    if (request.method === "POST" && action === "subscribe") {
      const { subscription } = await readJson(request);
      const clean = validateSubscription(subscription);
      const key = await pushKey(auth.sub, clean.endpoint);
      await store.put(key, {
        key,
        kind: "push-subscription",
        owner: auth.sub,
        deviceName: auth.deviceName || "",
        subscription: clean,
        updatedAt: new Date().toISOString(),
      });
      return json({ ok: true });
    }

    if (request.method === "POST" && action === "test") {
      const result = await sendTestNotifications(auth.sub, store, env);
      return json({ ok: true, ...result });
    }

    return errorJson(new Error("方法不支持"), 405);
  } catch (error) {
    return errorJson(error, error.message?.includes("权限") || error.message?.includes("令牌") ? 401 : 400);
  }
}

