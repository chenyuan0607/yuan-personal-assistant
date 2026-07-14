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
import { feedbackKey, validateFeedback } from "../edge-functions/_lib/feedback.js";
import chatHandler from "../edge-functions/api/chat.js";
import feedbackHandler from "../edge-functions/api/feedback.js";
import codexHandler, { saveMemory } from "../edge-functions/api/codex.js";
import { selectDeletable } from "../edge-functions/api/cleanup.js";

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

test("video links are acknowledged without spending a model call", async () => {
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
  let modelCalls = 0;
  globalThis.fetch = async () => {
    modelCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "should not run" } }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const env = { SESSION_SECRET: "secret", MODEL_ENDPOINT: "https://model.example", MODEL_API_KEY: "key", MODEL_NAME: "model" };
    const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
    const body = await (await chatHandler({
      env,
      request: new Request("https://app.example/api/chat?date=2026-07-14", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "https://v.douyin.com/abc123/", clientMessageId: "client-00000002" }),
      }),
    })).json();
    assert.equal(body.messages.at(-1).content, "已收到");
    assert.equal(modelCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("codex can archive a dated chat for nightly sync", async () => {
  const data = new Map([
    ["chat_owner_2026_07_14_user_1", { id: "user-1", role: "user", content: "今天聊了任务", date: "2026-07-14", createdAt: "2026-07-14T01:00:00Z", sources: [] }],
    ["chat_owner_2026_07_14_assistant_1", { id: "assistant-1", role: "assistant", content: "我们明天继续", date: "2026-07-14", createdAt: "2026-07-14T01:01:00Z", sources: [] }],
  ]);
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) {
      return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "# 2026-07-14 聊天整理" } }] }), {
    headers: { "content-type": "application/json" },
  });
  const env = { SESSION_SECRET: "secret", MODEL_ENDPOINT: "https://model.example", MODEL_API_KEY: "key", MODEL_NAME: "model" };
  const token = await issueToken({ sub: "owner", kind: "codex", exp: 9999999999 }, env.SESSION_SECRET);
  try {
    const archived = await (await codexHandler({
      env,
      request: new Request("https://app.example/api/codex?action=archive-chat", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-07-14" }),
      }),
    })).json();
    assert.equal(archived.archive.kind, "chat-archive");
    assert.equal(archived.archive.status, "waiting");
    assert.equal(data.get("archive_owner_2026_07_14").content, "# 2026-07-14 聊天整理");
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

test("feedback validation rejects ledger details and uses stable owner keys", () => {
  assert.throws(() => validateFeedback({ kind: "ledger-summary", records: [] }), /字段|摘要/);
  assert.equal(feedbackKey("owner", "ledger-summary", "2026-07-14", "ledger-1"), "feedback_owner_ledger_summary_2026_07_14_ledger_1");
});

test("task plan feedback keeps a bounded public task snapshot", () => {
  const result = validateFeedback({
    id: "plan-2026-07-14",
    kind: "task-plan",
    date: "2026-07-14",
    tasks: [{ taskId: "t1", title: "整理资料", plannedMinutes: 15 }],
    updatedAt: "2026-07-14T01:00:00Z",
  });
  assert.deepEqual(result.tasks, [{ taskId: "t1", title: "整理资料", plannedMinutes: 15 }]);
});

test("feedback relay overwrites daily summaries and Codex acknowledges only after pull", async () => {
  const data = new Map();
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) { return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
  };
  const env = { SESSION_SECRET: "secret" };
  const deviceToken = await issueToken({ sub: "owner", kind: "device", deviceName: "手机A", exp: 9999999999 }, env.SESSION_SECRET);
  const codexToken = await issueToken({ sub: "owner", kind: "codex", exp: 9999999999 }, env.SESSION_SECRET);
  const base = {
    id: "ledger-2026-07-14-phone-a", kind: "ledger-summary", date: "2026-07-14", deviceName: "手机A",
    incomeCents: 0, expenseCents: 1000, balanceCents: -1000, incomeCount: 0, expenseCount: 1,
    categories: { 餐饮: 1000 }, monthBudgetCents: 300000, monthExpenseCents: 1000,
    monthRemainingCents: 299000, budgetState: "normal", updatedAt: "2026-07-14T12:00:00Z",
  };
  const post = (body) => feedbackHandler({ env, request: new Request("https://app.example/api/feedback", { method: "POST", headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" }, body: JSON.stringify(body) }) });
  try {
    assert.equal((await post(base)).status, 200);
    assert.equal((await post({ ...base, expenseCents: 1500, balanceCents: -1500, categories: { 餐饮: 1500 }, monthExpenseCents: 1500, monthRemainingCents: 298500 })).status, 200);
    assert.equal([...data.keys()].filter((key) => key.startsWith("feedback_")).length, 1);
    const pulled = await (await codexHandler({ env, request: new Request("https://app.example/api/codex?action=feedback-pull&date=2026-07-14", { headers: { authorization: `Bearer ${codexToken}` } }) })).json();
    assert.equal(pulled.items.length, 1);
    assert.equal(pulled.items[0].expenseCents, 1500);
    const acked = await (await codexHandler({ env, request: new Request("https://app.example/api/codex?action=feedback-ack", { method: "POST", headers: { authorization: `Bearer ${codexToken}`, "content-type": "application/json" }, body: JSON.stringify({ ids: [base.id], localPath: "D:\\知识库\\报告.md" }) }) })).json();
    assert.equal(acked.ok, true);
    assert.equal([...data.values()].find((item) => item.id === base.id).status, "processed");
  } finally {
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("a late feedback update pulls the full date snapshot for report replacement", async () => {
  const values = new Map([
    ["feedback_owner_task_plan_2026_07_12_plan_2026_07_12", { id: "plan-2026-07-12", kind: "task-plan", date: "2026-07-12", status: "processed", createdAt: "2026-07-12T01:00:00Z", tasks: [] }],
    ["feedback_owner_ledger_summary_2026_07_12_ledger_1", { id: "ledger-1", kind: "ledger-summary", date: "2026-07-12", status: "waiting", createdAt: "2026-07-14T01:00:00Z", deviceName: "手机A" }],
    ["feedback_owner_task_plan_2026_07_11_plan_2026_07_11", { id: "plan-2026-07-11", kind: "task-plan", date: "2026-07-11", status: "processed", createdAt: "2026-07-11T01:00:00Z", tasks: [] }],
  ]);
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { values.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return values.get(key) ?? null; },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { complete: true, cursor: null, keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
  };
  const env = { SESSION_SECRET: "secret" };
  const token = await issueToken({ sub: "owner", kind: "codex", exp: 9999999999 }, env.SESSION_SECRET);
  try {
    const body = await (await codexHandler({ env, request: new Request("https://app.example/api/codex?action=feedback-pull", { headers: { authorization: `Bearer ${token}` } }) })).json();
    assert.deepEqual(body.items.map((item) => item.id).sort(), ["ledger-1", "plan-2026-07-12"]);
  } finally {
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});
