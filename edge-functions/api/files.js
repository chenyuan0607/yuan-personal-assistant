import { requireAuth } from "./auth.js";
import { sha256Bytes } from "../_lib/crypto.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { fileKey, filePrefix } from "../_lib/records.js";
import { blob, kv, listJson } from "../_lib/storage.js";

const allowedExtensions = /\.(png|jpe?g|gif|webp|pdf|docx?|md|txt)$/i;

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env);
    const metadata = kv(env);
    const objects = blob(env);
    if (request.method === "GET") return json({ ok: true, files: await listJson(filePrefix(owner.sub), metadata) });
    if (request.method === "PATCH") {
      const { id, action } = await readJson(request);
      const key = fileKey(owner.sub, id);
      const record = await metadata.get(key, { type: "json" });
      if (!record) throw new Error("文件不存在");
      if (action === "delete") {
        await objects.delete(record.blobKey);
        await metadata.delete(key);
        return json({ ok: true });
      }
      if (action === "keep") {
        await metadata.put(key, JSON.stringify({ ...record, keep: true }));
        return json({ ok: true });
      }
      if (action === "retry") {
        await metadata.put(key, JSON.stringify({ ...record, status: "waiting", processedAt: null, keep: false }));
        return json({ ok: true });
      }
      throw new Error("未知文件操作");
    }
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("文件必须小于20MB");
    if (!allowedExtensions.test(file.name)) throw new Error("暂不支持这种文件类型");
    const id = crypto.randomUUID();
    const blobKey = `${owner.sub}/${id}/${file.name.replaceAll("/", "_")}`;
    const bytes = await file.arrayBuffer();
    await objects.set(blobKey, file);
    const record = {
      id,
      kind: "file",
      blobKey,
      name: file.name,
      size: file.size,
      sha256: await sha256Bytes(bytes),
      type: file.type || "application/octet-stream",
      createdAt: new Date().toISOString(),
      status: "waiting",
    };
    await metadata.put(fileKey(owner.sub, id), JSON.stringify(record));
    return json({ ok: true, file: record }, 201);
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
