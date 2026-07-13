import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserStore, createMemoryStore } from "../js/assistant-store.js";
import { createAssistantApi } from "../js/assistant-api.js";
import { formatMessage, groupMessagesByDate } from "../js/assistant-view.js";
import { flushPending, localDate, safeSourceUrl } from "../js/assistant-ui.js";

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
