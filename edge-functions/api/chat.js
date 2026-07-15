import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { archiveKey, chatKey, chatPrefix, deferredLinkMessage, validateMessage } from "../_lib/records.js";
import { blob, kv, listJson } from "../_lib/storage.js";
import { buildArchiveMessages, buildImageReplyMessages, buildImageUnderstandingMessages, buildModelMessages, callModel, callVisionModel } from "../_lib/model.js";
import { fileKey } from "../_lib/records.js";
import { needsSearch, searchWeb } from "../_lib/search.js";

const memoryLatestKey = (ownerId) => `memory_${ownerId}_latest`;
const memoryIndexKey = (ownerId) => `memory_${ownerId}_index`;
const bytesToBase64 = (bytes) => {
  const array = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(array).toString("base64");
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const imagePreview = (fileRecord, imageBase64) => {
  if (!String(fileRecord?.type || "").startsWith("image/")) return null;
  if (!imageBase64 || imageBase64.length > 900000) return null;
  return `data:${fileRecord.type};base64,${imageBase64}`;
};
export const currentTimeText = (now = new Date()) => {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijing.getUTCDate()).padStart(2, "0");
  const hour = String(beijing.getUTCHours()).padStart(2, "0");
  const minute = String(beijing.getUTCMinutes()).padStart(2, "0");
  return `北京时间 ${year}年${month}月${day}日 ${hour}:${minute}（Asia/Shanghai，UTC+08:00，24小时制）`;
};
const exactTimeQuestion = (text) => /(现在几点|当前时间|现在时间|几点了|今天几号|今天日期|今天是几号)/.test(text);
const directTimeAnswer = (text, nowText) => `现在是${nowText}。`;

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
    const fileId = body.fileId;
    if (fileId && !/^[a-zA-Z0-9-]{8,80}$/.test(fileId)) throw new Error("文件编号无效");
    const clientMessageId = body.clientMessageId;
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientMessageId || "")) throw new Error("消息编号无效");
    const userKey = chatKey(owner.sub, date, clientMessageId);
    const assistantId = `${clientMessageId}_assistant`;
    const assistantKey = chatKey(owner.sub, date, assistantId);
    let userRecord = await getJson(store, userKey);
    const existingAssistant = await getJson(store, assistantKey);
    if (userRecord && existingAssistant) return json({ ok: true, duplicate: true, messages: [userRecord, existingAssistant] });
    const history = await listJson(chatPrefix(owner.sub, date), store);
    let fileRecord = null;
    let imageBase64 = "";
    if (fileId) {
      fileRecord = await getJson(store, fileKey(owner.sub, fileId));
      if (!fileRecord) throw new Error("文件不存在");
      if (!String(fileRecord.type || "").startsWith("image/")) throw new Error("目前只有图片可以发给AI识别");
      if (Number(fileRecord.size || 0) > 10 * 1024 * 1024) throw new Error("识图图片需要小于10MB");
      const objects = blob(env);
      if (typeof objects.bytes === "function") imageBase64 = bytesToBase64(await objects.bytes(fileRecord.blobKey));
    }
    if (!userRecord) {
      userRecord = {
        id: clientMessageId,
        role: "user",
        content: fileRecord ? `${userText}\n[图片：${fileRecord.name}]` : userText,
        date,
        createdAt: new Date().toISOString(),
        sources: [],
        ...(fileRecord ? { attachment: { id: fileRecord.id, name: fileRecord.name, type: fileRecord.type, preview: imagePreview(fileRecord, imageBase64) } } : {}),
      };
      await store.put(userKey, JSON.stringify(userRecord));
    }
    if (deferredLinkMessage(userText)) {
      const assistantRecord = { id: assistantId, role: "assistant", content: "已收到", date, createdAt: new Date().toISOString(), sources: [] };
      await store.put(assistantKey, JSON.stringify(assistantRecord));
      return json({ ok: true, messages: [userRecord, assistantRecord] });
    }
    if (!fileRecord && exactTimeQuestion(userText)) {
      const assistantRecord = { id: assistantId, role: "assistant", content: directTimeAnswer(userText, currentTimeText()), date, createdAt: new Date().toISOString(), sources: [] };
      await store.put(assistantKey, JSON.stringify(assistantRecord));
      return json({ ok: true, messages: [userRecord, assistantRecord] });
    }
    const memory = await store.get(memoryLatestKey(owner.sub)) || "";
    let sources = [];
    let searchNote = "";
    if (needsSearch(userText)) {
      try {
        sources = await searchWeb(userText, env);
      } catch {
        searchNote = "联网搜索暂时不可用；请基于已有信息回答，并明确提醒用户最新情况尚未确认。";
      }
    }
    let answer;
    if (fileRecord) {
      const objects = blob(env);
      let imageUrl;
      if (imageBase64) imageUrl = imageBase64;
      else if (typeof objects.bytes === "function") imageUrl = bytesToBase64(await objects.bytes(fileRecord.blobKey));
      else if (typeof objects.url === "function") imageUrl = await objects.url(fileRecord.blobKey);
      else throw new Error("文件读取能力尚未配置");
      const imageSummary = await callVisionModel(buildImageUnderstandingMessages({ imageUrl, userText }), env);
      answer = await callModel(buildImageReplyMessages({ memory, history, userText, imageSummary, currentTime: currentTimeText() }), env);
    } else {
      answer = await callModel(buildModelMessages({ memory, history, userText, sources, searchNote, currentTime: currentTimeText() }), env);
    }
    const assistantRecord = { id: assistantId, role: "assistant", content: answer, date, createdAt: new Date().toISOString(), sources };
    await store.put(assistantKey, JSON.stringify(assistantRecord));
    return json({ ok: true, messages: [userRecord, assistantRecord] });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
