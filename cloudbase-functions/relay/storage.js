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

export function createCloudBaseBlob(app, prefix = "yuan-assistant-files") {
  if (!app || typeof app.uploadFile !== "function" || typeof app.deleteFile !== "function") {
    throw new Error("CloudBase file storage is not configured");
  }

  return {
    async set(key, file) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const cloudPath = `${prefix}/${key.replace(/^\/+/, "")}`;
      const result = await app.uploadFile({ cloudPath, fileContent: bytes });
      return result.fileID || result.fileId || cloudPath;
    },

    async delete(fileID) {
      await app.deleteFile({ fileList: [fileID] });
    },

    async bytes(fileID) {
      if (typeof app.downloadFile !== "function") throw new Error("CloudBase file download is not configured");
      const result = await app.downloadFile({ fileID });
      const content = result.fileContent || result.FileContent || result.body;
      if (!content) throw new Error("CloudBase downloaded file is empty");
      return content;
    },

    async url(fileID) {
      if (typeof app.getTempFileURL !== "function") throw new Error("CloudBase temporary file URL is not configured");
      const result = await app.getTempFileURL({ fileList: [fileID] });
      const item = result.fileList?.[0] || result.fileList?.find?.((entry) => entry.fileID === fileID);
      const url = item?.tempFileURL || item?.download_url || item?.url;
      if (!url) throw new Error("CloudBase temporary file URL is empty");
      return url;
    },
  };
}
