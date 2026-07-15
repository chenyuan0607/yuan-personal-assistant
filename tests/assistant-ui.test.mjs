import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createBrowserStore, createMemoryStore } from "../js/assistant-store.js";
import { createAssistantApi } from "../js/assistant-api.js";
import { flushFeedback, syncTaskProgress } from "../js/feedback-sync.js";
import { formatChatTimeLabel, formatMessage, groupMessagesByDate, shouldShowTimeDivider } from "../js/assistant-view.js";
import { parseStickerMessage, refreshAssistantData, flushPending, loadAssistantSnapshot, localDate, safeSourceUrl } from "../js/assistant-ui.js";

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

test("assistant sticker messages only accept local sticker assets", () => {
  assert.deepEqual(parseStickerMessage("[表情包:开心](./assets/stickers/fluent/happy.png)"), {
    label: "开心",
    src: "./assets/stickers/fluent/happy.png",
  });
  assert.equal(parseStickerMessage("[表情包:坏](https://example.com/hack.png)"), null);
  assert.equal(parseStickerMessage("普通聊天"), null);
});

test("message view preserves image attachment preview for chat bubbles", () => {
  const view = formatMessage({
    role: "user",
    content: "我发了一张图片",
    attachment: { name: "photo.png", type: "image/png", preview: "data:image/png;base64,AAAA" },
  });
  assert.deepEqual(view.attachment, { name: "photo.png", type: "image/png", preview: "data:image/png;base64,AAAA" });
});

test("chat time labels follow messaging app style", () => {
  const now = new Date("2026-07-15T05:11:00+08:00");
  assert.equal(formatChatTimeLabel("2026-07-15T04:53:00+08:00", now), "04:53");
  assert.equal(formatChatTimeLabel("2026-07-14T15:52:00+08:00", now), "昨天 15:52");
  assert.equal(shouldShowTimeDivider(null, { createdAt: "2026-07-15T04:53:00+08:00" }), true);
  assert.equal(shouldShowTimeDivider({ createdAt: "2026-07-15T04:53:00+08:00" }, { createdAt: "2026-07-15T04:59:00+08:00" }), false);
  assert.equal(shouldShowTimeDivider({ createdAt: "2026-07-15T04:53:00+08:00" }, { createdAt: "2026-07-15T05:11:00+08:00" }), true);
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

test("feedback api pulls dated task progress for cross-device sync", async () => {
  const calls = [];
  const api = createAssistantApi({
    baseUrl: "https://assistant.example",
    getToken: () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, items: [{ id: "e1", kind: "task-result" }] }), { headers: { "content-type": "application/json" } });
    },
  });
  const body = await api.listFeedback("2026-07-15");
  assert.equal(calls[0].url, "https://assistant.example/api/feedback?date=2026-07-15");
  assert.equal(calls[0].options.headers.authorization, "Bearer token");
  assert.deepEqual(body.items, [{ id: "e1", kind: "task-result" }]);
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

test("task progress sync merges remote task results without re-uploading them", async () => {
  const added = [];
  const store = {
    mergeResults: (items) => added.push(...items),
  };
  const result = await syncTaskProgress(store, {
    hasToken: () => true,
    listFeedback: async (date) => ({
      items: [
        { id: "plan-2026-07-15", kind: "task-plan", date },
        { id: "r1", kind: "task-result", date, taskId: "t1", outcome: "completed" },
        { id: "l1", kind: "ledger-summary", date },
      ],
    }),
  }, "2026-07-15");
  assert.equal(result.merged, 2);
  assert.deepEqual(added.map((item) => item.id), ["plan-2026-07-15", "r1"]);
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

test("assistant reloads chat after sending pending messages", async () => {
  const store = createMemoryStore({ pending: [{ id: "p1", text: "你好", date: "2026-07-15" }] });
  const snapshots = [
    { messages: [{ id: "old", role: "assistant", content: "旧消息" }], memory: null, archive: null },
    { messages: [{ id: "p1", role: "user", content: "你好" }, { id: "a1", role: "assistant", content: "收到啦" }], memory: null, archive: null },
  ];
  const result = await refreshAssistantData(store, {
    listMessages: async () => snapshots.shift(),
    listFiles: async () => ({ files: [] }),
    sendMessage: async () => {},
  }, "2026-07-15");

  assert.deepEqual(result.chatData.messages.map((item) => item.id), ["p1", "a1"]);
  assert.deepEqual(store.pending(), []);
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

test("assistant chat shell removes the old header and opens a roof tools page", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /class="assistant-heading"|id="assistant-lock"|今天的对话|锁定/);
  assert.match(html, /id="assistant-menu-view"/);
  assert.match(html, /id="assistant-menu-back"/);
  assert.match(html, /<h2>聊天信息<\/h2>/);
  assert.match(html, /id="assistant-menu-avatar"/);
  assert.match(html, /id="assistant-menu-archive"/);
  assert.match(html, /href="https:\/\/platform\.deepseek\.com\/top_up"/);
  assert.match(html, /href="https:\/\/bigmodel\.cn\/finance-center\/finance\/pay"/);
  assert.match(html, /识图充值|璇嗗浘鍏呭€?/);
  assert.match(html, /class="assistant-info-list"/);
  assert.match(html, /class="assistant-info-row"/);
  assert.doesNotMatch(html, /assistant-action-grid|assistant-action-card|聊天信息[\s\S]{0,500}assistant-avatar-image/);
  assert.match(script, /showAssistantMenu/);
  assert.match(script, /api\.directArchive\(localDate\(\)\)/);
  assert.match(css, /\.assistant-menu-page/);
  assert.match(css, /\.assistant-info-list/);
  assert.match(css, /\.assistant-info-row/);
  assert.match(css, /\.assistant-composer\{[^}]*border-top:0/);
});

test("assistant chat uses a WeChat-like roof page instead of avatar actions", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /class="assistant-chat-topbar"/);
  assert.match(html, /id="assistant-menu"[^>]+>…<\/button>/);
  assert.doesNotMatch(html, /id="assistant-menu-panel"/);
  assert.match(html, /id="assistant-menu-avatar"/);
  assert.match(html, /id="assistant-menu-archive"/);
  assert.match(html, /data-tool-view="assistant-backstage-view"/);
  assert.doesNotMatch(html, /<button class="tool-entry" type="button" data-tool-view="assistant-backstage-view"/);
  const assistantSection = html.match(/<section id="assistant-view"[\s\S]*?<\/section>/)?.[0] || "";
  assert.doesNotMatch(assistantSection, /assistant-back-button|← 返回/);
  assert.match(script, /#assistant-menu/);
  assert.match(script, /#assistant-menu-archive/);
  assert.match(script, /assistant-menu-view/);
  assert.match(script, /assistant-view/);
  assert.doesNotMatch(script, /createAvatarActionMenu/);
  assert.doesNotMatch(script, /button\.className = "assistant-avatar"/);
  assert.match(css, /\.assistant-chat-topbar/);
  assert.match(css, /\.assistant-time-divider/);
  assert.match(css, /\.assistant-message\.user\{[^}]*background:#95ec69/);
});

test("assistant keeps the latest thinking message above the fixed composer", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /scrollLatestMessageIntoView/);
  assert.match(script, /list\.scrollTop = list\.scrollHeight/);
  assert.match(script, /requestAnimationFrame\(scrollToBottom\)/);
  assert.match(script, /setTimeout\(scrollToBottom, 80\)/);
  assert.doesNotMatch(script, /scrollIntoView/);
  assert.match(script, /assistant-time-divider/);
  assert.match(css, /\.assistant-messages\{[^}]*padding-bottom:96px/);
  assert.match(css, /\.assistant-messages\{[^}]*scroll-padding-bottom:96px/);
});

test("assistant renders an AI thinking bubble while a sent message is pending", async () => {
  const script = await readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8");

  assert.match(script, /createThinkingMessage/);
  assert.match(script, /role: "assistant"/);
  assert.match(script, /content: "正在思考中…"/);
});

test("assistant renders sticker messages as local images", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /parseStickerMessage/);
  assert.match(script, /assistant-sticker-message/);
  assert.match(css, /\.assistant-sticker-message/);
});

test("assistant renders uploaded image messages as image bubbles", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /assistant-uploaded-image/);
  assert.match(script, /message\.attachment\?\.preview/);
  assert.match(css, /\.assistant-uploaded-image/);
});

test("assistant composer uses a plus button for file upload instead of mic", async () => {
  const [html, tools, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/assistant-tools.js", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(html, /id="assistant-mic"|按住说话|鎸変綇璇磋瘽/);
  assert.match(html, /<label[^>]+id="assistant-upload"[^>]+for="assistant-file"/);
  assert.match(html, /id="assistant-file"[^>]+accept="image\/\*,\.pdf,\.txt,\.md,\.csv,\.tsv,\.xls,\.xlsx,\.doc,\.docx"/);
  assert.doesNotMatch(html, /id="assistant-file"[^>]+hidden/);
  assert.match(html, /id="assistant-file"[^>]+class="assistant-file-input"/);
  assert.match(html, /aria-label="上传文件"|aria-label="涓婁紶鏂囦欢"/);
  assert.match(html, />\+<\/label>/);
  assert.doesNotMatch(tools, /assistantFile\.click\(\)|uploadEntry\.addEventListener\("click"/);
  assert.match(css, /\.assistant-file-input/);
});

test("assistant composer overlays chat without a reserved gray spacer", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(css, /\.assistant-view\{[^}]*padding:58px 0 64px/);
  assert.match(css, /\.assistant-messages\{[^}]*height:calc\(100vh - 128px\)/);
  assert.match(css, /\.assistant-messages\{[^}]*max-height:calc\(100vh - 128px\)/);
  assert.match(css, /\.assistant-messages\{[^}]*padding:8px 8px 0/);
  assert.match(css, /\.assistant-messages\{[^}]*scroll-padding-bottom:0/);
  assert.match(css, /\.assistant-messages\{[^}]*display:flex/);
  assert.match(css, /\.assistant-messages\{[^}]*flex-direction:column/);
  assert.match(css, /\.assistant-messages::before\{content:"";margin-top:auto\}/);
  assert.match(css, /\.assistant-message-row\{[^}]*flex-shrink:0/);
  assert.match(css, /\.assistant-composer\{[^}]*padding:0 10px/);
  assert.match(css, /\.assistant-composer\{[^}]*background:transparent/);
  assert.doesNotMatch(css, /\.assistant-view\{[^}]*padding:58px 0 1[0-9]{2}px/);
  assert.doesNotMatch(css, /\.assistant-messages\{[^}]*padding:8px 8px 1[0-9]{2}px/);
});

test("assistant sends an uploaded image to chat after file upload succeeds", async () => {
  const script = await readFile(new URL("../js/assistant-ui.js", import.meta.url), "utf8");

  assert.match(script, /file\.type\.startsWith\("image\/"\)/);
  assert.match(script, /api\.sendImageMessage/);
  assert.match(script, /fileData\.file\.id/);
  assert.match(script, /我发了一张图片，请帮我看看。|鎴戝彂浜嗕竴寮犲浘鐗囷紝璇峰府鎴戠湅鐪嬨€?/);
});
