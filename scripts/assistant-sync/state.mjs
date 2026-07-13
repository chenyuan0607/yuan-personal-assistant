import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function openState(path) {
  await mkdir(dirname(path), { recursive: true });
  let data = { processed: {} };
  try { data = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const save = async () => {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await rename(temporary, path);
  };
  return {
    hasReceived: (id) => Boolean(data.processed[id]),
    isProcessed: (id) => Boolean(data.processed[id]?.processedAt),
    get: (id) => data.processed[id],
    pending: () => Object.entries(data.processed).filter(([, value]) => !value.processedAt).map(([id, value]) => ({ id, ...value })),
    async markReceived(id, metadata) {
      data.processed[id] = { ...data.processed[id], ...metadata, receivedAt: data.processed[id]?.receivedAt || new Date().toISOString() };
      await save();
    },
    async markProcessed(id, metadata) {
      data.processed[id] = { ...data.processed[id], ...metadata, processedAt: new Date().toISOString() };
      await save();
    },
  };
}
