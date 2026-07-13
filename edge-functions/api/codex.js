import { requireAuth } from "./auth.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { archiveKey, archivePrefix, fileKey, filePrefix } from "../_lib/records.js";
import { blob, kv, listJson } from "../_lib/storage.js";

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
    const objects = blob(env);
    const action = new URL(request.url).searchParams.get("action") || "pull";
    if (request.method === "GET" && action === "pull") {
      const files = (await listJson(filePrefix(owner.sub), metadata)).filter((item) => item.status === "waiting");
      const archives = (await listJson(archivePrefix(owner.sub), metadata)).filter((item) => item.status === "waiting");
      return json({ ok: true, items: [...files, ...archives].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    }
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const body = await readJson(request);
    if (action === "download") {
      const record = await metadata.get(fileKey(owner.sub, body.id), { type: "json" });
      if (!record) throw new Error("文件不存在");
      const content = await objects.get(record.blobKey, { type: "arrayBuffer", consistency: "strong" });
      return new Response(content, { headers: { "content-type": record.type } });
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
    throw new Error("未知操作");
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
