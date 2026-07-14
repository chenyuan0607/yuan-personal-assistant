import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createBrowserStore, createMemoryStore } from "../js/assistant-store.js";
import { createAssistantApi } from "../js/assistant-api.js";
import { flushFeedback } from "../js/feedback-sync.js";
import { formatMessage, groupMessagesByDate } from "../js/assistant-view.js";
import { refreshAssistantData, flushPending, loadAssistantSnapshot, localDate, safeSourceUrl } from "../js/assistant-ui.js";

test("pending messages survive until acknowledged in insertion order", () => {
  const store = createMemoryStore();
  store.enqueue({ id: "m1", text: "一" });
  store.enqueue({ id: "m2", text: "二" });
  assert.deepEqual(store.pending().map((item) => item.text), ["一", "二"]);
  store.ack("m1");
  assert.deepEqual(store.pending().map((item) => item.id), ["m2"]);
});

test("assistant browser session remembers the device name with the token", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const store = createBrowserStore(storage);
  store.setSession({ token: "token", deviceName: "手机A" });
  assert.equal(store.token(), "token");
  assert.equal(store.deviceName(), "手机A");
  store.clearToken();
  assert.equal(store.token(), null);
  assert.equal(store.deviceName(), "手机A");
});

test("message view exposes safe source fields without interpreting html", () => {
  const view = formatMessage({ role: "assistant", content: "<b>答案</b>", sources: [{ title: "来源", url: "https://example.com", date: "2026-07-13" }] });
  assert.equal(view.content, "<b>答案</b>");
  assert.deepEqual(view.sources, [{ title: "来源", url: "https://example.com", date: "2026-07-13" }]);
});

test("messages are grouped by their explicit date", () => {
  assert.deepEqual(Object.keys(groupMessagesByDate([{ date: "2026-07-13" }, { date: "2026-07-14" }])), ["2026-07-13", "2026-07-14"]);
});

test("api client adds bearer token and reuses the client message id", async () => {
  const calls = [];
  const api = createAssistantApi({
    baseUrl: "https://assistant.example",
    getToken: () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, messages: [] }), { headers: { "content-type": "application/json" } });
    },
  });
  await api.sendMessage("你好", "2026-07-13", "client-12345678");
  assert.equal(calls[0].options.headers.authorization, "Bearer token");
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: "你好", clientMessageId: "client-12345678" });
});

test("api errors retain the response status", async () => {
  const api = createAssistantApi({
    baseUrl: "https://assistant.example",
    getToken: () => "bad",
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "过期" }), { status: 401, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(api.listMessages("2026-07-13"), (error) => error.status === 401 && error.message === "过期");
});

test("feedback api sends bearer-authenticated records", async () => {
  const calls = [];
  const api = createAssistantApi({
    baseUrl: "https://assistant.example",
    getToken: () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    },
  });
  await api.saveFeedback({ id: "e1", kind: "task-result" });
  assert.equal(calls[0].url, "https://assistant.example/api/feedback");
  assert.equal(calls[0].options.headers.authorization, "Bearer token");
  assert.deepEqual(JSON.parse(calls[0].options.body), { id: "e1", kind: "task-result" });
});

test("feedback queue is acknowledged only after successful upload", async () => {
  const pending = [{ id: "e1" }, { id: "e2" }];
  const acked = [];
  const store = { pending: () => pending.filter((item) => !acked.includes(item.id)), ack: (id) => acked.push(id) };
  await assert.rejects(() => flushFeedback(store, { hasToken: () => true, saveFeedback: async (item) => { if (item.id === "e2") throw new Error("offline"); } }), /offline/);
  assert.deepEqual(acked, ["e1"]);
  assert.deepEqual(store.pending().map((item) => item.id), ["e2"]);
});

test("assistant helpers use local dates, safe links and ordered replay", async () => {
  assert.equal(localDate(new Date(2026, 6, 13, 23, 30)), "2026-07-13");
  assert.equal(safeSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeSourceUrl("https://example.com/a"), "https://example.com/a");
  const store = createMemoryStore({ pending: [{ id: "1", text: "一", date: "2026-07-13" }, { id: "2", text: "二", date: "2026-07-13" }] });
  const sent = [];
  await flushPending(store, { sendMessage: async (text) => sent.push(text) });
  assert.deepEqual(sent, ["一", "二"]);
  assert.deepEqual(store.pending(), []);
});

test("chat remains available when temporary file transfer is unavailable", async () => {
  const result = await loadAssistantSnapshot({
    listMessages: async () => ({ messages: [{ id: "m1", role: "assistant", content: "ok" }] }),
    listFiles: async () => { throw new Error("files unavailable"); },
  }, "2026-07-14");

  assert.deepEqual(result.chatData.messages.map((item) => item.id), ["m1"]);
  assert.deepEqual(result.fileData.files, []);
  assert.equal(result.fileAvailable, false);
});

test("memory snapshot loads even when pending replay fails", async () => {
  const store = createMemoryStore({ pending: [{ id: "p1", text: "未发出", date: "2026-07-15" }] });
  const result = await refreshAssistantData(store, {
    listMessages: async () => ({ messages: [], memory: { version: "v1", createdAt: "now" }, archive: null }),
    listFiles: async () => ({ files: [] }),
    sendMessage: async () => {
      const error = new Error("AI暂时无法回答");
      error.status = 400;
      throw error;
    },
  }, "2026-07-15");

  assert.equal(result.chatData.memory.version, "v1");
  assert.equal(result.pendingError.message, "AI暂时无法回答");
  assert.deepEqual(store.pending().map((item) => item.id), ["p1"]);
});

test("assistant shows thinking state without archive actions", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /<button[^>]+assistant-(preview|direct)-archive|查看今日整理|直接归档并休息/);
  assert.match(html, /<span id="assistant-preview-archive" hidden><\/span>/);
  assert.match(html, /<span id="assistant-direct-archive" hidden><\/span>/);
  assert.doesNotMatch(script, /assistant-(preview|direct)-archive/);
  assert.match(script, /正在思考中/);
  assert.doesNotMatch(script, /等待同步|正在发送/);
});

test("assistant avatar belongs to AI message rows instead of the heading", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /assistant-heading[^>]*>[\s\S]{0,400}id="assistant-avatar"/);
  assert.match(html, /id="assistant-avatar-file"[^>]+hidden/);
  assert.match(script, /message-row/);
  assert.match(script, /message\.role === "assistant"/);
  assert.match(script, /createAvatarButton/);
  assert.match(css, /\.assistant-message-row\.user/);
  assert.match(css, /\.assistant-message-row\.assistant/);
});
