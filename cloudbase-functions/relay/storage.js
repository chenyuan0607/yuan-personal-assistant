function parseValue(value, type) {
  if (value == null) return null;
  if (type === "json") return typeof value === "string" ? JSON.parse(value) : value;
  return value;
}

export function createCloudBaseStore({ collection, regexp }) {
  if (!collection || typeof regexp !== "function") throw new Error("CloudBase database is not configured");

  return {
    async get(key, options = {}) {
      const result = await collection.doc(key).get();
      const record = result.data?.[0];
      return record ? parseValue(record.value, options.type) : null;
    },

    async put(key, value) {
      await collection.doc(key).set({ key, value, updatedAt: new Date().toISOString() });
    },

    async delete(key) {
      await collection.doc(key).remove();
    },

    async list({ prefix = "", limit = 256, cursor } = {}) {
      const offset = Number.parseInt(cursor || "0", 10);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid storage cursor");
      const result = await collection
        .where({ key: regexp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
        .orderBy("key", "asc")
        .skip(offset)
        .limit(limit + 1)
        .get();
      const records = result.data ?? [];
      const complete = records.length <= limit;
      return {
        keys: records.slice(0, limit).map((item) => ({ key: item.key })),
        complete,
        cursor: complete ? null : String(offset + limit),
      };
    },
  };
}
