import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { archiveKey, archivePrefix, chatPrefix, fileKey, filePrefix } from "../_lib/records.js";
import { feedbackKey, feedbackPrefix } from "../_lib/feedback.js";
import { blob, kv, listJson } from "../_lib/storage.js";
import { buildArchiveMessages, callModel } from "../_lib/model.js";

const safePart = (value) => String(value).replace(/[^A-Za-z0-9]/g, "_");
const memoryKey = (ownerId, version) => `memory_${safePart(ownerId)}_${safePart(version)}`;
const memoryLatestKey = (ownerId) => `memory_${safePart(ownerId)}_latest`;
const memoryIndexKey = (ownerId) => `memory_${safePart(ownerId)}_index`;

export async function saveMemory(store, ownerId, content, version, createdAt = new Date().toISOString()) {
  const versions = await store.get(memoryIndexKey(ownerId), { type: "json" }) ?? [];
  const next = [{ version, createdAt }, ...versions.filter((item) => item.version !== version)];
  await store.put(memoryKey(ownerId, version), content);
  await store.put(memoryLatestKey(ownerId), content);
  for (const old of next.slice(7)) await store.delete(memoryKey(ownerId, old.version));
  await store.put(memoryIndexKey(ownerId), JSON.stringify(next.slice(0, 7)));
}

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env, "codex");
    const metadata = kv(env);
    const action = new URL(request.url).searchParams.get("action") || "pull";
    if (request.method === "GET" && action === "pull") {
      const files = (await listJson(filePrefix(owner.sub), metadata)).filter((item) => item.status === "waiting");
      const archives = (await listJson(archivePrefix(owner.sub), metadata)).filter((item) => item.status === "waiting");
      return json({ ok: true, items: [...files, ...archives].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    }
    if (request.method === "GET" && action === "feedback-pull") {
      const date = new URL(request.url).searchParams.get("date");
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("反馈日期无效");
      const records = await listJson(feedbackPrefix(owner.sub), metadata);
      const waitingDates = new Set(records.filter((item) => item.status === "waiting" && (!date || item.date === date)).map((item) => item.date));
      const items = records.filter((item) => waitingDates.has(item.date));
      return json({ ok: true, items });
    }
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const body = await readJson(request);
    if (action === "download") {
      const objects = blob(env);
      const record = await metadata.get(fileKey(owner.sub, body.id), { type: "json" });
      if (!record) throw new Error("文件不存在");
      const content = await objects.get(record.blobKey, { type: "arrayBuffer", consistency: "strong" });
      return new Response(content, { headers: { "content-type": record.type } });
    }
    if (action === "archive-chat") {
      const archiveDate = String(body.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(archiveDate)) throw new Error("聊天归档日期无效");
      const history = await listJson(chatPrefix(owner.sub, archiveDate), metadata);
      if (!history.length) throw new Error("当天还没有可以整理的对话");
      const document = await callModel(buildArchiveMessages(history, archiveDate), env);
      const record = {
        id: `chat_${archiveDate.replaceAll("-", "_")}`,
        kind: "chat-archive",
        date: archiveDate,
        content: document,
        messageIds: history.map((item) => item.id),
        createdAt: new Date().toISOString(),
        status: "waiting",
      };
      await metadata.put(archiveKey(owner.sub, archiveDate), JSON.stringify(record));
      return json({ ok: true, archive: record });
    }
    if (action === "ack") {
      const key = body.kind === "chat-archive" ? archiveKey(owner.sub, body.date) : fileKey(owner.sub, body.id);
      const record = await metadata.get(key, { type: "json" });
      if (!record) throw new Error("资料不存在");
      await metadata.put(key, JSON.stringify({ ...record, status: "processed", processedAt: new Date().toISOString(), localPath: body.localPath }));
      return json({ ok: true });
    }
    if (action === "memory") {
      if (!body.content || String(body.content).length > 100000) throw new Error("记忆包内容无效");
      const version = body.version || new Date().toISOString();
      await saveMemory(metadata, owner.sub, body.content, version);
      return json({ ok: true, version });
    }
    if (action === "feedback-ack") {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.some((id) => typeof id !== "string")) throw new Error("反馈编号无效");
      const records = await listJson(feedbackPrefix(owner.sub), metadata);
      const selected = body.ids.map((id) => records.find((item) => item.id === id));
      if (selected.some((item) => !item)) throw new Error("反馈不存在");
      const processedAt = new Date().toISOString();
      for (const record of selected) {
        await metadata.put(feedbackKey(owner.sub, record.kind, record.date, record.id), JSON.stringify({ ...record, status: "processed", processedAt, localPath: String(body.localPath || "") }));
      }
      return json({ ok: true, processed: body.ids });
    }
    throw new Error("未知操作");
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
