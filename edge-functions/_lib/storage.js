import { getStore } from "@edgeone/pages-blob";

export function kv(env) {
  const store = env?.YUAN_ASSISTANT_KV ?? globalThis.YUAN_ASSISTANT_KV;
  if (!store) throw new Error("KV命名空间尚未绑定");
  return store;
}

export const blob = (env) => env?.YUAN_ASSISTANT_BLOB ?? getStore("yuan-assistant-files");

export async function listJson(prefix, store = kv()) {
  const records = [];
  let cursor;
  do {
    const page = await store.list({ prefix, limit: 256, ...(cursor ? { cursor } : {}) });
    for (const item of page.keys ?? []) {
      const value = await store.get(item.key, { type: "json" });
      if (value) records.push(value);
    }
    cursor = page.complete ? null : page.cursor;
  } while (cursor);
  return records.sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
}
