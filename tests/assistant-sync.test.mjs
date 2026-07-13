import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../scripts/assistant-sync/config.mjs";
import { createEdgeOneClient } from "../scripts/assistant-sync/edgeone-client.mjs";
import { createImaClient } from "../scripts/assistant-sync/ima-client.mjs";
import { buildDailyDocument, buildMemoryPack, safeName } from "../scripts/assistant-sync/organize.mjs";
import { pull, publish } from "../scripts/assistant-sync/run.mjs";
import { openState } from "../scripts/assistant-sync/state.mjs";

test("config separates pull requirements from IMA publish requirements", () => {
  const base = { EDGEONE_API_URL: "https://edge.example", EDGEONE_CODEX_TOKEN: "token", YUAN_KB_ROOT: "D:\\知识库" };
  assert.equal(loadConfig(base).edgeoneToken, "token");
  assert.throws(() => loadConfig(base, { requireIma: true }), /IMA_OPENAPI_CLIENTID/);
});

test("sync state persists received and processed phases atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yuan-sync-"));
  const state = await openState(join(dir, "state.json"));
  await state.markReceived("item-1", { localPath: "x.md" });
  assert.equal(state.hasReceived("item-1"), true);
  assert.equal(state.isProcessed("item-1"), false);
  await state.markProcessed("item-1", { formalPath: "daily.md" });
  assert.equal(state.isProcessed("item-1"), true);
  assert.match(await readFile(join(dir, "state.json"), "utf8"), /item-1/);
});

test("EdgeOne client sends bearer token and item ids", async () => {
  const calls = [];
  const client = createEdgeOneClient("https://edge.example", "secret", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, items: [] }), { headers: { "content-type": "application/json" } });
  });
  await client.pull();
  await client.download("f1");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(calls[1].options.body), { id: "f1" });
});

test("IMA client writes Markdown with official authentication headers", async () => {
  const calls = [];
  const client = createImaClient({ clientId: "id", apiKey: "key", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ code: 0, data: { note_id: "n1" } }), { headers: { "content-type": "application/json" } });
  } });
  assert.equal(await client.importNote("# 标题\n\n正文"), "n1");
  assert.equal(calls[0].options.headers["ima-openapi-clientid"], "id");
});

test("organizer creates safe compact Markdown", () => {
  assert.equal(safeName('a<b>:c?.md'), "a_b__c_.md");
  assert.match(buildDailyDocument({ date: "2026-07-13", summary: "完成方案", decisions: ["使用EdgeOne"] }), /使用EdgeOne/);
  const memory = buildMemoryPack({ preferences: ["回答直接"], goals: ["完善助手"] });
  assert.match(memory, /回答直接/);
  assert.doesNotMatch(memory, /原始聊天/);
});

test("pull never acknowledges and failed IMA publish never deletes sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "yuan-kb-"));
  const env = {
    EDGEONE_API_URL: "https://edge.example", EDGEONE_CODEX_TOKEN: "token", YUAN_KB_ROOT: root,
    IMA_OPENAPI_CLIENTID: "id", IMA_OPENAPI_APIKEY: "key", IMA_KNOWLEDGE_BASE_ID: "kb",
  };
  const calls = [];
  const edgeFactory = () => ({
    pull: async () => ({ items: [{ id: "chat-1", kind: "chat-archive", date: "2026-07-13", content: "原始内容" }] }),
    ack: async () => calls.push("ack"), uploadMemory: async () => calls.push("memory"), cleanup: async () => calls.push("cleanup"),
  });
  const pulled = await pull(env, { edgeFactory, now: new Date(2026, 6, 13, 8, 30) });
  assert.deepEqual(calls, []);
  await mkdir(join(root, "05-projects", "daily-conversations"), { recursive: true });
  await mkdir(join(root, "05-projects", "mobile-assistant"), { recursive: true });
  await writeFile(join(root, "05-projects", "daily-conversations", "2026-07-13.md"), "# 正式记录");
  await writeFile(join(root, "05-projects", "mobile-assistant", "手机助手记忆包.md"), "# 记忆包");
  const imaFactory = () => ({ importNote: async () => { throw new Error("IMA失败"); } });
  await assert.rejects(() => publish(pulled.batchPath, env, { edgeFactory, imaFactory }), /IMA失败/);
  assert.deepEqual(calls, ["memory"]);
});
