import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { archiveKey, chatKey, chatPrefix, deferredLinkMessage, validateMessage } from "../_lib/records.js";
import { kv, listJson } from "../_lib/storage.js";
import { buildArchiveMessages, buildModelMessages, callModel } from "../_lib/model.js";
import { needsSearch, searchWeb } from "../_lib/search.js";

const memoryLatestKey = (ownerId) => `memory_${ownerId}_latest`;
const memoryIndexKey = (ownerId) => `memory_${ownerId}_index`;
const currentTimeText = (now = new Date()) => `${new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(now)} Asia/Shanghai`;

async function getJson(store, key) {
  return store.get(key, { type: "json" });
}

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env);
    const store = kv(env);
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    if (request.method === "GET") {
      const versions = await getJson(store, memoryIndexKey(owner.sub)) ?? [];
      const archive = await getJson(store, archiveKey(owner.sub, date));
      return json({
        ok: true,
        messages: await listJson(chatPrefix(owner.sub, date), store),
        memory: versions[0] || null,
        archive,
      });
    }
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const action = url.searchParams.get("action") || "send";
    const body = await readJson(request);
    if (action === "archive-preview" || action === "archive-direct") {
      const archiveDate = body.date || date;
      const history = await listJson(chatPrefix(owner.sub, archiveDate), store);
      if (!history.length) throw new Error("今天还没有可以整理的对话");
      const document = await callModel(buildArchiveMessages(history, archiveDate), env);
      if (action === "archive-preview") return json({ ok: true, document });
      const record = {
        id: `chat_${archiveDate.replaceAll("-", "_")}`,
        kind: "chat-archive",
        date: archiveDate,
        content: document,
        messageIds: history.map((item) => item.id),
        createdAt: new Date().toISOString(),
        status: "waiting",
      };
      await store.put(archiveKey(owner.sub, archiveDate), JSON.stringify(record));
      return json({ ok: true, archive: record });
    }
    if (action !== "send") throw new Error("未知操作");
    const userText = validateMessage(body.text);
    const clientMessageId = body.clientMessageId;
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientMessageId || "")) throw new Error("消息编号无效");
    const userKey = chatKey(owner.sub, date, clientMessageId);
    const assistantId = `${clientMessageId}_assistant`;
    const assistantKey = chatKey(owner.sub, date, assistantId);
    let userRecord = await getJson(store, userKey);
    const existingAssistant = await getJson(store, assistantKey);
    if (userRecord && existingAssistant) return json({ ok: true, duplicate: true, messages: [userRecord, existingAssistant] });
    const history = await listJson(chatPrefix(owner.sub, date), store);
    if (!userRecord) {
      userRecord = { id: clientMessageId, role: "user", content: userText, date, createdAt: new Date().toISOString(), sources: [] };
      await store.put(userKey, JSON.stringify(userRecord));
    }
    if (deferredLinkMessage(userText)) {
      const assistantRecord = { id: assistantId, role: "assistant", content: "已收到", date, createdAt: new Date().toISOString(), sources: [] };
      await store.put(assistantKey, JSON.stringify(assistantRecord));
      return json({ ok: true, messages: [userRecord, assistantRecord] });
    }
    const memory = await store.get(memoryLatestKey(owner.sub)) || "";
    const sources = needsSearch(userText) ? await searchWeb(userText, env) : [];
    const answer = await callModel(buildModelMessages({ memory, history, userText, sources, currentTime: currentTimeText() }), env);
    const assistantRecord = { id: assistantId, role: "assistant", content: answer, date, createdAt: new Date().toISOString(), sources };
    await store.put(assistantKey, JSON.stringify(assistantRecord));
    return json({ ok: true, messages: [userRecord, assistantRecord] });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
