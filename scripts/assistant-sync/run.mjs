import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { createEdgeOneClient } from "./edgeone-client.mjs";
import { createImaClient } from "./ima-client.mjs";
import { safeName } from "./organize.mjs";
import { openState } from "./state.mjs";

const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export async function pull(env = process.env, { edgeFactory = createEdgeOneClient, now = new Date() } = {}) {
  const config = loadConfig(env);
  const edge = edgeFactory(config.edgeoneApiUrl, config.edgeoneToken);
  const systemDir = join(config.knowledgeRoot, ".system", "assistant-sync");
  const inboxDir = join(config.knowledgeRoot, "00-inbox", "edgeone待整理");
  const batchDir = join(systemDir, "batches");
  await mkdir(inboxDir, { recursive: true }); await mkdir(batchDir, { recursive: true });
  const state = await openState(join(systemDir, "sync-state.json"));
  const pulled = await edge.pull();
  for (const item of pulled.items ?? []) {
    if (state.hasReceived(item.id)) continue;
    const name = item.kind === "chat-archive" ? `${item.date}-聊天整理.md` : `${item.id}-${safeName(item.name)}`;
    const localPath = join(inboxDir, name);
    if (item.kind === "chat-archive") await writeFile(localPath, item.content, "utf8");
    else {
      const bytes = new Uint8Array(await edge.download(item.id));
      if (bytes.byteLength !== item.size) throw new Error(`文件大小校验失败：${item.id}`);
      if (createHash("sha256").update(bytes).digest("base64url") !== item.sha256) throw new Error(`文件哈希校验失败：${item.id}`);
      await writeFile(localPath, bytes);
    }
    await state.markReceived(item.id, { localPath, kind: item.kind, date: item.date || "" });
  }
  const date = localDate(now);
  const batch = { id: `${date}-${now.getTime()}`, date, createdAt: now.toISOString(), items: state.pending() };
  const batchPath = join(batchDir, `${batch.id}.json`);
  await writeFile(batchPath, JSON.stringify(batch, null, 2), "utf8");
  return { downloaded: batch.items.length, batchPath };
}

export async function publish(batchPath, env = process.env, { edgeFactory = createEdgeOneClient, imaFactory = createImaClient } = {}) {
  const config = loadConfig(env, { requireIma: true });
  const edge = edgeFactory(config.edgeoneApiUrl, config.edgeoneToken);
  const ima = imaFactory({ clientId: config.imaClientId, apiKey: config.imaApiKey });
  const batch = JSON.parse(await readFile(batchPath, "utf8"));
  const dailyPath = join(config.knowledgeRoot, "05-projects", "daily-conversations", `${batch.date}.md`);
  const memoryPath = join(config.knowledgeRoot, "05-projects", "mobile-assistant", "手机助手记忆包.md");
  const daily = await readFile(dailyPath, "utf8");
  const memory = await readFile(memoryPath, "utf8");
  await edge.uploadMemory(memory, `${batch.date}-${Date.now()}`);
  const noteId = await ima.importNote(daily, config.imaFolderId);
  await ima.addNoteToKnowledgeBase({ noteId, title: `${batch.date} 每日记录`, knowledgeBaseId: config.imaKnowledgeBaseId, folderId: config.imaFolderId });
  const state = await openState(join(config.knowledgeRoot, ".system", "assistant-sync", "sync-state.json"));
  for (const item of batch.items) {
    await edge.ack(item, dailyPath);
    await state.markProcessed(item.id, { formalPath: dailyPath, imaNoteId: noteId });
  }
  await edge.cleanup();
  return { processed: batch.items.length, dailyPath, memoryPath, noteId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command = "pull", batchPath] = process.argv.slice(2);
  const operation = command === "pull" ? pull() : command === "publish" && batchPath ? publish(batchPath) : Promise.reject(new Error("用法：run.mjs pull 或 run.mjs publish <batchPath>"));
  operation.then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
