import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveKey,
  chatKey,
  fileKey,
  retentionState,
  validateMessage,
} from "../edge-functions/_lib/records.js";
import { issueToken, sha256, verifyToken } from "../edge-functions/_lib/crypto.js";
import { buildArchiveMessages, buildModelMessages } from "../edge-functions/_lib/model.js";
import { needsSearch } from "../edge-functions/_lib/search.js";
import { listJson } from "../edge-functions/_lib/storage.js";
import chatHandler from "../edge-functions/api/chat.js";
import { selectDeletable } from "../edge-functions/api/cleanup.js";
import { saveMemory } from "../edge-functions/api/codex.js";

test("record keys are stable and owner scoped", () => {
  assert.equal(chatKey("owner", "2026-07-13", "m-1"), "chat_owner_2026_07_13_m_1");
  assert.equal(archiveKey("owner", "2026-07-13"), "archive_owner_2026_07_13");
  assert.equal(fileKey("owner", "f-1"), "file_owner_f_1");
  assert.match(chatKey("owner", "2026-07-13", "m-1"), /^[A-Za-z0-9_]+$/);
});

test("messages reject empty or oversized text", () => {
  assert.throws(() => validateMessage(""), /消息不能为空/);
  assert.throws(() => validateMessage("x".repeat(8001)), /8000/);
  assert.equal(validateMessage(" 你好 "), "你好");
});

test("processed records wait seven days and unprocessed records report after thirty", () => {
  const now = Date.parse("2026-07-20T00:00:00Z");
  assert.equal(retentionState({ processedAt: "2026-07-13T00:00:00Z" }, now), "deletable");
  assert.equal(retentionState({ createdAt: "2026-06-20T00:00:00Z" }, now), "expired-unprocessed");
  assert.equal(retentionState({ createdAt: "2026-07-19T00:00:00Z" }, now), "keep");
  assert.equal(retentionState({ processedAt: "2026-07-01T00:00:00Z", keep: true }, now), "keep");
});

test("signed tokens round trip and reject tampering or expiry", async () => {
  const token = await issueToken({ sub: "owner", kind: "device", exp: 200 }, "secret", 100);
  assert.equal((await verifyToken(token, "secret", 150)).sub, "owner");
  await assert.rejects(() => verifyToken(`${token}x`, "secret", 150), /无效/);
  await assert.rejects(() => verifyToken(token, "secret", 201), /过期/);
  assert.equal(await sha256("访问码"), await sha256("访问码"));
});

test("search is controlled by current-information intent and user override", () => {
  assert.equal(needsSearch("请联网查今天的新闻"), true);
  assert.equal(needsSearch("不要联网，只根据你记得的回答"), false);
  assert.equal(needsSearch("我今天心情不好"), false);
  assert.equal(needsSearch("现在DeepSeek价格是多少"), true);
});

test("model messages include compact memory and archive prompt keeps the date", () => {
  const messages = buildModelMessages({
    memory: "沟通偏好：直接",
    history: [{ role: "user", content: "你好" }],
    userText: "继续",
  });
  assert.match(messages[0].content, /沟通偏好：直接/);
  assert.equal(messages.at(-1).content, "继续");
  assert.match(buildArchiveMessages(messages, "2026-07-13")[1].content, /2026-07-13/);
});

test("KV listing follows official pagination and reads key fields", async () => {
  const values = new Map([
    ["chat_owner_2026_07_13_1", { id: "1", createdAt: "2026-07-13T01:00:00Z" }],
    ["chat_owner_2026_07_13_2", { id: "2", createdAt: "2026-07-13T02:00:00Z" }],
  ]);
  const store = {
    async list({ cursor }) {
      return cursor
        ? { complete: true, cursor: null, keys: [{ key: "chat_owner_2026_07_13_2" }] }
        : { complete: false, cursor: "next", keys: [{ key: "chat_owner_2026_07_13_1" }] };
    },
    async get(key) { return values.get(key); },
  };
  assert.deepEqual((await listJson("chat_owner_", store)).map((item) => item.id), ["1", "2"]);
});

test("chat send is idempotent and direct archive enters the Codex inbox", async () => {
  const data = new Map();
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) {
      return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "整理后的内容" } }] }), {
    headers: { "content-type": "application/json" },
  });
  try {
    const env = { SESSION_SECRET: "secret", MODEL_ENDPOINT: "https://model.example", MODEL_API_KEY: "key", MODEL_NAME: "model" };
    const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
    const call = (url, body) => chatHandler({
      env,
      request: new Request(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const first = await (await call("https://app.example/api/chat?date=2026-07-13", { text: "你好", clientMessageId: "client-00000001" })).json();
    assert.equal(first.messages.length, 2);
    const duplicate = await (await call("https://app.example/api/chat?date=2026-07-13", { text: "你好", clientMessageId: "client-00000001" })).json();
    assert.equal(duplicate.duplicate, true);
    const archived = await (await call("https://app.example/api/chat?action=archive-direct", { date: "2026-07-13" })).json();
    assert.equal(archived.archive.kind, "chat-archive");
    assert.equal(archived.archive.status, "waiting");
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("cleanup selects only processed records past retention", () => {
  const now = Date.parse("2026-07-21T00:00:00Z");
  const selected = selectDeletable([
    { id: "old", processedAt: "2026-07-13T00:00:00Z" },
    { id: "new", processedAt: "2026-07-20T00:00:00Z" },
    { id: "kept", processedAt: "2026-07-01T00:00:00Z", keep: true },
  ], now);
  assert.deepEqual(selected.map((item) => item.id), ["old"]);
});

test("memory storage keeps the latest seven versions", async () => {
  const data = new Map();
  const store = {
    async get(key) { return data.get(key) ?? null; },
    async put(key, value) { data.set(key, typeof value === "string" && value.startsWith("[") ? JSON.parse(value) : value); },
    async delete(key) { data.delete(key); },
  };
  for (let index = 1; index <= 8; index += 1) {
    await saveMemory(store, "owner", `记忆${index}`, `v${index}`, `2026-07-${String(index).padStart(2, "0")}T00:00:00Z`);
  }
  const versions = data.get("memory_owner_index");
  assert.equal(versions.length, 7);
  assert.equal(versions[0].version, "v8");
  assert.equal(data.has("memory_owner_v1"), false);
  assert.equal(data.get("memory_owner_latest"), "记忆8");
});
