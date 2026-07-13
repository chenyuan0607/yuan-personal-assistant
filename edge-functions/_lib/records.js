const DAY = 24 * 60 * 60 * 1000;

const safePart = (value) => String(value).replace(/[^A-Za-z0-9]/g, "_");

export const chatPrefix = (ownerId, date) => `chat_${safePart(ownerId)}_${safePart(date)}_`;
export const chatKey = (ownerId, date, messageId) => `${chatPrefix(ownerId, date)}${safePart(messageId)}`;
export const archivePrefix = (ownerId) => `archive_${safePart(ownerId)}_`;
export const archiveKey = (ownerId, date) => `${archivePrefix(ownerId)}${safePart(date)}`;
export const filePrefix = (ownerId) => `file_${safePart(ownerId)}_`;
export const fileKey = (ownerId, fileId) => `${filePrefix(ownerId)}${safePart(fileId)}`;

export function validateMessage(value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("消息不能为空");
  if (text.length > 8000) throw new Error("单条消息不能超过8000字");
  return text;
}

export function retentionState(record, now = Date.now()) {
  if (record.keep === true) return "keep";
  if (record.processedAt && now - Date.parse(record.processedAt) >= 7 * DAY) return "deletable";
  if (!record.processedAt && record.createdAt && now - Date.parse(record.createdAt) >= 30 * DAY) return "expired-unprocessed";
  return "keep";
}
