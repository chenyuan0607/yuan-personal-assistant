import webpush from "web-push";

import { sha256 } from "./crypto.js";
import { listJson } from "./storage.js";

const PUSH_PREFIX = "push_";
const DEFAULT_SUBJECT = "mailto:qingqing@example.invalid";

export const safePart = (value) => String(value || "").replace(/[^A-Za-z0-9_]/g, "_");
export const pushPrefix = (owner) => `${PUSH_PREFIX}${safePart(owner)}_`;

export async function pushKey(owner, endpoint) {
  return `${pushPrefix(owner)}${safePart(await sha256(endpoint))}`;
}

export function configureWebPush(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error("主动通知还没有配置推送密钥");
  const sender = env.WEB_PUSH_IMPL || webpush;
  sender.setVapidDetails(env.VAPID_SUBJECT || DEFAULT_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return sender;
}

export function isExpiredPushError(error) {
  return error?.statusCode === 404 || error?.statusCode === 410;
}

export async function sendPushToOwner(owner, store, env, payload) {
  const sender = configureWebPush(env);
  const records = await listJson(pushPrefix(owner), store);
  let sent = 0;
  let removed = 0;
  for (const record of records) {
    try {
      await sender.sendNotification(record.subscription, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      if (!isExpiredPushError(error)) throw error;
      await store.delete(record.key);
      removed += 1;
    }
  }
  return { sent, removed };
}
