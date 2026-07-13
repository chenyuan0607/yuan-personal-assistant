import { requireAuth } from "./auth.js";
import { errorJson, json } from "../_lib/http.js";
import { archiveKey, archivePrefix, chatKey, fileKey, filePrefix, retentionState } from "../_lib/records.js";
import { feedbackKey, feedbackPrefix } from "../_lib/feedback.js";
import { blob, kv, listJson } from "../_lib/storage.js";

export const selectDeletable = (records, now = Date.now()) => records.filter((record) => retentionState(record, now) === "deletable");

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env, "codex");
    if (request.method !== "POST") return errorJson(new Error("方法不支持"), 405);
    const metadata = kv(env);
    const objects = blob(env);
    const selectedFiles = selectDeletable(await listJson(filePrefix(owner.sub), metadata));
    const selectedArchives = selectDeletable(await listJson(archivePrefix(owner.sub), metadata));
    const selectedFeedback = selectDeletable(await listJson(feedbackPrefix(owner.sub), metadata));
    for (const record of selectedFiles) {
      await objects.delete(record.blobKey);
      await metadata.delete(fileKey(owner.sub, record.id));
    }
    for (const record of selectedArchives) {
      for (const messageId of record.messageIds ?? []) await metadata.delete(chatKey(owner.sub, record.date, messageId));
      await metadata.delete(archiveKey(owner.sub, record.date));
    }
    for (const record of selectedFeedback) await metadata.delete(feedbackKey(owner.sub, record.kind, record.date, record.id));
    return json({ ok: true, deleted: [...selectedFiles, ...selectedArchives, ...selectedFeedback].map((item) => item.id) });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
