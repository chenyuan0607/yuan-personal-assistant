import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { chatKey, validateMessage } from "../_lib/records.js";
import { kv } from "../_lib/storage.js";

const DEFAULT_MODEL = "qwen3.5-omni-flash-realtime";
const DEFAULT_VOICE = "Tina";

function sessionPayload(payload, env) {
  const clientSecret = payload?.client_secret?.value || payload?.clientSecret || payload?.token || "";
  const url = payload?.url || payload?.ws_url || env.REALTIME_WS_URL || "";
  const id = String(payload?.id || payload?.session_id || crypto.randomUUID());
  if (!clientSecret || !url) throw new Error("实时语音服务没有返回可用会话");
  return {
    id,
    url,
    clientSecret,
    protocols: Array.isArray(payload?.protocols) ? payload.protocols.filter((item) => typeof item === "string") : [],
    expiresAt: payload?.client_secret?.expires_at || payload?.expires_at || null,
  };
}

function proxySession(env) {
  if (!env.REALTIME_PROXY_WS_URL) return null;
  const voice = env.REALTIME_VOICE || DEFAULT_VOICE;
  const url = new URL(env.REALTIME_PROXY_WS_URL);
  if (!/^wss?:$/.test(url.protocol)) throw new Error("实时语音 WebSocket 地址无效");
  if (!url.searchParams.has("voice")) url.searchParams.set("voice", voice);
  return {
    id: `proxy-${crypto.randomUUID()}`,
    url: url.toString(),
    clientSecret: "",
    protocols: [],
    expiresAt: null,
    model: env.REALTIME_MODEL || DEFAULT_MODEL,
    voice,
  };
}

async function startSession(env) {
  const proxied = proxySession(env);
  if (proxied) return proxied;
  if (!env.REALTIME_API_KEY || !env.REALTIME_SESSION_ENDPOINT) throw new Error("实时语音尚未在服务端配置");
  const model = env.REALTIME_MODEL || DEFAULT_MODEL;
  const voice = env.REALTIME_VOICE || DEFAULT_VOICE;
  const requestBody = {
    model,
    modalities: ["text", "audio"],
    voice,
  };
  const response = await (env.REALTIME_FETCH || fetch)(env.REALTIME_SESSION_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.REALTIME_API_KEY}` },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw new Error("实时语音服务暂时无法创建会话");
  return { ...sessionPayload(await response.json(), env), model, voice };
}

function validSessionId(value) {
  return /^[A-Za-z0-9_-]{8,120}$/.test(String(value || ""));
}

async function saveTranscript({ body, ownerId, store }) {
  const date = String(body.date || "");
  const sessionId = String(body.sessionId || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !validSessionId(sessionId)) throw new Error("通话记录编号无效");
  const rows = Array.isArray(body.messages) ? body.messages.slice(0, 40) : [];
  if (!rows.length) throw new Error("没有需要保存的通话文字");
  let saved = 0;
  for (const [index, item] of rows.entries()) {
    if (!["user", "assistant"].includes(item?.role)) continue;
    const content = validateMessage(item.content);
    const id = validSessionId(item.id) ? item.id : `${sessionId}-${index + 1}`;
    const key = chatKey(ownerId, date, id);
    if (await store.get(key, { type: "json" })) continue;
    await store.put(key, JSON.stringify({
      id,
      role: item.role,
      content,
      date,
      createdAt: new Date().toISOString(),
      sources: [],
      callSessionId: sessionId,
    }));
    saved += 1;
  }
  return saved;
}

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env);
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const action = new URL(request.url).searchParams.get("action") || "start";
    const body = await readJson(request);
    if (action === "transcript") return json({ ok: true, saved: await saveTranscript({ body, ownerId: owner.sub, store: kv(env) }) });
    if (action !== "start") return errorJson(new Error("未知操作"), 400);
    return json({ ok: true, session: await startSession(env) });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
