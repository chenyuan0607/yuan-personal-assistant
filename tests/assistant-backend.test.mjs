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
import { needsSearch, searchWeb } from "../edge-functions/_lib/search.js";
import { listJson } from "../edge-functions/_lib/storage.js";
import { feedbackKey, validateFeedback } from "../edge-functions/_lib/feedback.js";
import chatHandler, { currentTimeText } from "../edge-functions/api/chat.js";
import filesHandler from "../edge-functions/api/files.js";
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
  assert.equal(needsSearch("今天抖音热点有哪些"), true);
  assert.equal(needsSearch("小红书最近在流行什么"), true);
  assert.equal(needsSearch("这个报名截止了吗"), true);
  assert.equal(needsSearch("我有点累怎么办"), false);
  assert.equal(needsSearch("不用搜索，今天抖音热点有哪些"), false);
});

test("search adapter uses configured provider or default lightweight web search", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://search.example")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer search-key");
      assert.deepEqual(JSON.parse(options.body), { query: "今天抖音热点", limit: 5 });
      return new Response(JSON.stringify({ results: [{ title: "热榜", url: "https://example.com/a", snippet: "摘要", date: "2026-07-15" }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    assert.match(String(url), /^https:\/\/s\.jina\.ai\//);
    assert.equal(options.headers.accept, "application/json");
    return new Response(JSON.stringify({ data: [{ title: "默认搜索", url: "https://example.com/b", content: "内容", date: "2026-07-15" }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    assert.deepEqual(await searchWeb("今天抖音热点", { SEARCH_ENDPOINT: "https://search.example/query", SEARCH_API_KEY: "search-key" }), [
      { title: "热榜", url: "https://example.com/a", snippet: "摘要", date: "2026-07-15" },
    ]);
    assert.deepEqual(await searchWeb("今天抖音热点", {}), [
      { title: "默认搜索", url: "https://example.com/b", snippet: "内容", date: "2026-07-15" },
    ]);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search adapter supports Zhipu BigModel web search", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://open.bigmodel.cn/api/paas/v4/web_search");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.authorization, "Bearer zhipu-key");
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      search_result: [{
        title: "智谱搜索结果",
        link: "https://example.com/zhipu",
        content: "适合 AI 处理的网页摘要",
        publish_date: "2026-07-15",
      }],
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const results = await searchWeb("今天抖音热点有哪些", {
      SEARCH_PROVIDER: "zhipu",
      SEARCH_ENDPOINT: "https://open.bigmodel.cn/api/paas/v4/web_search",
      SEARCH_API_KEY: "zhipu-key",
      SEARCH_ENGINE: "search_std",
    });
    assert.deepEqual(requestBody, {
      search_query: "今天抖音热点有哪些",
      search_engine: "search_std",
      search_intent: false,
      count: 5,
      search_recency_filter: "oneDay",
      content_size: "medium",
      user_id: "yuan_assistant_owner",
    });
    assert.deepEqual(results, [{
      title: "智谱搜索结果",
      url: "https://example.com/zhipu",
      snippet: "适合 AI 处理的网页摘要",
      date: "2026-07-15",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("default search falls back to a public search page when lightweight search fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://s.jina.ai/")) {
      return new Response("bad gateway", { status: 502 });
    }
    return new Response(`
      <html>
        <li class="b_algo">
          <h2><a href="https://example.com/hot">抖音热榜入口</a></h2>
          <p>今天抖音热点摘要。</p>
        </li>
      </html>
    `, { headers: { "content-type": "text/html" } });
  };
  try {
    const results = await searchWeb("今天抖音热点有哪些", {});
    assert.equal(calls.length, 2);
    assert.equal(calls[1], `https://www.bing.com/search?q=${encodeURIComponent("今天抖音热点有哪些")}`);
    assert.deepEqual(results, [{ title: "抖音热榜入口", url: "https://example.com/hot", snippet: "今天抖音热点摘要。", date: "" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("default search falls back to a domestic search page when public search page fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://s.jina.ai/") || String(url).startsWith("https://www.bing.com/search")) {
      return new Response("bad gateway", { status: 502 });
    }
    return new Response(`
      <html>
        <li class="res-list">
          <h3 class="res-title">
            <a href="https://www.so.com/link?m=test" data-mdurl="https://www.douyin.com/hot">今日抖音热点榜 - 抖音</a>
          </h3>
          <p class="res-desc"><span>2026年7月15日 - </span>抖音热点摘要。</p>
        </li>
      </html>
    `, { headers: { "content-type": "text/html" } });
  };
  try {
    const results = await searchWeb("今天抖音热点有哪些", {});
    assert.equal(calls.length, 3);
    assert.equal(calls[2], `https://www.so.com/s?q=${encodeURIComponent("今天抖音热点有哪些")}`);
    assert.deepEqual(results, [{ title: "今日抖音热点榜 - 抖音", url: "https://www.douyin.com/hot", snippet: "2026年7月15日 - 抖音热点摘要。", date: "" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model messages include compact memory and archive prompt keeps the date", () => {
  const messages = buildModelMessages({
    memory: "沟通偏好：直接",
    history: [{ role: "user", content: "你好" }],
    userText: "继续",
    currentTime: "北京时间 2026年07月15日 15:46（Asia/Shanghai，UTC+08:00，24小时制）",
  });
  assert.match(messages[0].content, /沟通偏好：直接/);
  assert.match(messages[0].content, /当前时间：北京时间 2026年07月15日 15:46/);
  assert.match(messages[0].content, /24小时制/);
  assert.match(messages[0].content, /北京时间.*不要换算成 UTC/);
  assert.match(messages[0].content, /问.*现在几点.*必须.*当前时间/);
  assert.equal(messages.at(-1).content, "【当前北京时间】北京时间 2026年07月15日 15:46（Asia/Shanghai，UTC+08:00，24小时制）\n继续");
  assert.match(buildArchiveMessages(messages, "2026-07-13")[1].content, /2026-07-13/);
});

test("current time text is explicit Beijing time instead of UTC", () => {
  assert.equal(
    currentTimeText(new Date("2026-07-15T07:46:00.000Z")),
    "北京时间 2026年07月15日 15:46（Asia/Shanghai，UTC+08:00，24小时制）",
  );
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

test("exact time questions are answered by the backend Beijing clock without model calls", async () => {
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
    return new Response(JSON.stringify({ choices: [{ message: { content: "wrong" } }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const env = { SESSION_SECRET: "secret", MODEL_ENDPOINT: "https://model.example", MODEL_API_KEY: "key", MODEL_NAME: "model" };
    const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
    const body = await (await chatHandler({
      env,
      request: new Request("https://app.example/api/chat?date=2026-07-15", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "现在几点？", clientMessageId: "time-00000001" }),
      }),
    })).json();
    assert.equal(modelCalls, 0);
    assert.match(body.messages.at(-1).content, /北京时间/);
    assert.doesNotMatch(body.messages.at(-1).content, /wrong/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("chat searches for current热点 questions but not casual support", async () => {
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
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url) === "https://search.example/query") {
      return new Response(JSON.stringify({ results: [{ title: "抖音热榜", url: "https://example.com/hot", snippet: "今天热榜摘要", date: "2026-07-15" }] }), {
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(options.body);
    const system = body.messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: system.includes("抖音热榜") ? "已结合热榜回答" : "不联网陪你聊" } }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const env = {
      SESSION_SECRET: "secret",
      MODEL_ENDPOINT: "https://model.example",
      MODEL_API_KEY: "key",
      MODEL_NAME: "model",
      SEARCH_ENDPOINT: "https://search.example/query",
      SEARCH_API_KEY: "search-key",
    };
    const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
    const requestChat = (text, clientMessageId) => chatHandler({
      env,
      request: new Request("https://app.example/api/chat?date=2026-07-15", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text, clientMessageId }),
      }),
    });
    const hot = await (await requestChat("今天抖音热点有哪些", "hot-00000001")).json();
    const casual = await (await requestChat("我有点累怎么办", "talk-00000001")).json();
    assert.equal(calls.filter((item) => item.url === "https://search.example/query").length, 1);
    assert.equal(hot.messages.at(-1).content, "已结合热榜回答");
    assert.deepEqual(hot.messages.at(-1).sources, [{ title: "抖音热榜", url: "https://example.com/hot", snippet: "今天热榜摘要", date: "2026-07-15" }]);
    assert.equal(casual.messages.at(-1).content, "不联网陪你聊");
    assert.deepEqual(casual.messages.at(-1).sources, []);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("chat keeps answering when web search is temporarily unavailable", async () => {
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
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://search.example/query") {
      return new Response(JSON.stringify({ error: "down" }), { status: 503 });
    }
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /联网搜索暂时不可用/);
    return new Response(JSON.stringify({ choices: [{ message: { content: "我先按已有信息回答，并提醒你最新情况未确认" } }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const env = {
      SESSION_SECRET: "secret",
      MODEL_ENDPOINT: "https://model.example",
      MODEL_API_KEY: "key",
      MODEL_NAME: "model",
      SEARCH_ENDPOINT: "https://search.example/query",
    };
    const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
    const response = await chatHandler({
      env,
      request: new Request("https://app.example/api/chat?date=2026-07-15", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "今天抖音热点有哪些", clientMessageId: "hot-00000002" }),
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.messages.at(-1).content, "我先按已有信息回答，并提醒你最新情况未确认");
    assert.deepEqual(body.messages.at(-1).sources, []);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("file upload stores the blob key returned by the active file store", async () => {
  const data = new Map();
  const uploaded = [];
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) {
      return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const env = {
    SESSION_SECRET: "secret",
    YUAN_ASSISTANT_BLOB: {
      async set(key, file) {
        uploaded.push({ key, name: file.name });
        return `cloud://bucket/${key}`;
      },
      async delete() {},
    },
  };
  const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
  const form = new FormData();
  form.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  try {
    const body = await (await filesHandler({
      env,
      request: new Request("https://app.example/api/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }),
    })).json();
    assert.equal(body.file.blobKey.startsWith("cloud://bucket/owner/"), true);
    assert.equal(uploaded[0].name, "note.txt");
  } finally {
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("file upload accepts spreadsheet and plain data files for nightly markdown organizing", async () => {
  const data = new Map();
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) {
      return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const env = {
    SESSION_SECRET: "secret",
    YUAN_ASSISTANT_BLOB: {
      async set(key) { return `cloud://bucket/${key}`; },
      async delete() {},
    },
  };
  const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
  const form = new FormData();
  form.append("file", new File(["a,b\n1,2"], "table.csv", { type: "text/csv" }));
  try {
    const body = await (await filesHandler({
      env,
      request: new Request("https://app.example/api/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form }),
    })).json();
    assert.equal(body.ok, true);
    assert.equal(body.file.status, "waiting");
    assert.equal(body.file.name, "table.csv");
  } finally {
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("codex downloads CloudBase files through the bytes adapter for nightly organizing", async () => {
  const data = new Map([["file_owner_file_1", {
    id: "file-1",
    kind: "file",
    blobKey: "cloud://bucket/file.csv",
    name: "file.csv",
    size: 7,
    sha256: "unused",
    type: "text/csv",
    createdAt: "2026-07-15T00:00:00Z",
    status: "waiting",
  }]]);
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) {
      return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const env = {
    SESSION_SECRET: "secret",
    YUAN_ASSISTANT_BLOB: {
      async bytes(blobKey) {
        assert.equal(blobKey, "cloud://bucket/file.csv");
        return new TextEncoder().encode("a,b\n1,2");
      },
    },
  };
  const token = await issueToken({ sub: "owner", kind: "codex", exp: 9999999999 }, env.SESSION_SECRET);
  try {
    const response = await codexHandler({
      env,
      request: new Request("https://app.example/api/codex?action=download", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: "file-1" }),
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "a,b\n1,2");
    assert.equal(response.headers.get("content-type"), "text/csv");
  } finally {
    delete globalThis.YUAN_ASSISTANT_KV;
  }
});

test("chat image message uses the vision model with the uploaded file URL before replying", async () => {
  const uploadedFileId = "11111111-1111-4111-8111-111111111111";
  const data = new Map([
    ["file_owner_11111111_1111_4111_8111_111111111111", {
      id: uploadedFileId,
      kind: "file",
      blobKey: "cloud://bucket/owner/11111111-1111-4111-8111-111111111111/photo.png",
      name: "photo.png",
      size: 100,
      type: "image/png",
      createdAt: "2026-07-15T00:00:00Z",
      status: "waiting",
    }],
  ]);
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) {
      return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url === "https://vision.example/chat/completions") {
      assert.equal(body.model, "glm-4.6v-flash");
      assert.equal(body.messages[0].content[0].type, "image_url");
      assert.equal(body.messages[0].content[0].image_url.url, Buffer.from("fake-image-bytes").toString("base64"));
      return new Response(JSON.stringify({ choices: [{ message: { content: "图片里是一只橘猫。" } }] }), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "我看到了：图片里是一只橘猫。" } }] }), { headers: { "content-type": "application/json" } });
  };
  const env = {
    SESSION_SECRET: "secret",
    MODEL_ENDPOINT: "https://model.example/chat/completions",
    MODEL_API_KEY: "text-key",
    MODEL_NAME: "deepseek",
    VISION_MODEL_ENDPOINT: "https://vision.example/chat/completions",
    VISION_MODEL_API_KEY: "vision-key",
    VISION_MODEL_NAME: "glm-4.6v-flash",
    YUAN_ASSISTANT_BLOB: {
      async bytes(blobKey) {
        assert.equal(blobKey, "cloud://bucket/owner/11111111-1111-4111-8111-111111111111/photo.png");
        return Buffer.from("prefix-fake-image-bytes-suffix").subarray(7, 23);
      },
      async url() {
        throw new Error("base64 path should be preferred");
      },
    },
  };
  const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
  try {
    const body = await (await chatHandler({
      env,
      request: new Request("https://app.example/api/chat?date=2026-07-15", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "我发了一张图片，请帮我看看。", fileId: uploadedFileId, clientMessageId: "image-12345678" }),
      }),
    })).json();
    assert.equal(body.ok, true);
    assert.equal(body.messages[0].attachment.name, "photo.png");
    assert.equal(body.messages[0].attachment.preview, `data:image/png;base64,${Buffer.from("fake-image-bytes").toString("base64")}`);
    assert.match(body.messages[1].content, /橘猫/);
    assert.equal(calls.length, 2);
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

test("device can pull synced task progress for a date", async () => {
  const data = new Map([
    ["feedback_owner_task_plan_2026_07_15_plan_2026_07_15", { id: "plan-2026-07-15", kind: "task-plan", date: "2026-07-15", status: "processed", tasks: [], updatedAt: "2026-07-15T01:00:00Z" }],
    ["feedback_owner_task_result_2026_07_15_r1", { id: "r1", kind: "task-result", date: "2026-07-15", status: "waiting", taskId: "t1", title: "整理资料", plannedMinutes: 15, focusedSeconds: 300, outcome: "completed", completedAt: "2026-07-15T02:00:00Z", deviceName: "手机A" }],
    ["feedback_owner_ledger_summary_2026_07_15_l1", { id: "l1", kind: "ledger-summary", date: "2026-07-15", status: "waiting" }],
    ["feedback_owner_task_result_2026_07_14_old", { id: "old", kind: "task-result", date: "2026-07-14", status: "waiting", taskId: "old" }],
  ]);
  globalThis.YUAN_ASSISTANT_KV = {
    async put(key, value) { data.set(key, typeof value === "string" ? JSON.parse(value) : value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    async list({ prefix }) { return { complete: true, cursor: null, keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
  };
  const env = { SESSION_SECRET: "secret" };
  const token = await issueToken({ sub: "owner", kind: "device", exp: 9999999999 }, env.SESSION_SECRET);
  try {
    const response = await feedbackHandler({ env, request: new Request("https://app.example/api/feedback?date=2026-07-15", { headers: { authorization: `Bearer ${token}` } }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.items.map((item) => item.id).sort(), ["plan-2026-07-15", "r1"]);
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
