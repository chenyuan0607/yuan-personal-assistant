# EdgeOne Assistant Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the secure EdgeOne Makers backend that authenticates two phones, synchronizes chat, stores temporary files, calls the AI/search adapters, exposes Codex transfer APIs, and deletes processed temporary data safely.

**Architecture:** EdgeOne Edge Functions provide JSON APIs under `/api`, KV stores sessions/chat/status/memory metadata, and Blob stores temporary files. Shared modules are pure ESM so they can be tested with Node's built-in test runner before deployment. Provider-specific model and search calls sit behind small adapters.

**Tech Stack:** Vanilla JavaScript ESM, Node test runner, EdgeOne Edge Functions, `@edgeone/pages-kv`, `@edgeone/pages-blob`, Web Crypto, Fetch API.

---

## File map

- Modify: `package.json` — add EdgeOne SDK dependencies and backend test script.
- Create: `edge-functions/_lib/http.js` — JSON response and request helpers.
- Create: `edge-functions/_lib/crypto.js` — hashing, token signing, token verification.
- Create: `edge-functions/_lib/records.js` — record keys, validation, retention calculations.
- Create: `edge-functions/_lib/storage.js` — KV/Blob access boundary.
- Create: `edge-functions/_lib/model.js` — model-provider adapter and daily-summary prompt.
- Create: `edge-functions/_lib/search.js` — controlled-search policy and provider adapter.
- Create: `edge-functions/api/auth.js` — device login/logout.
- Create: `edge-functions/api/chat.js` — idempotent list/send/archive chat.
- Create: `edge-functions/api/files.js` — upload/list/delete temporary files.
- Create: `edge-functions/api/codex.js` — Codex pull/ack/memory endpoints.
- Create: `edge-functions/api/cleanup.js` — authenticated retention cleanup.
- Create: `scripts/generate-codex-token.mjs` — generate the computer-only token locally without exposing the signing secret.
- Create: `tests/assistant-backend.test.mjs` — pure backend behavior tests.
- Create: `docs/edgeone-setup.md` — account, secrets, KV, Blob, deployment instructions.

### Task 1: Add backend contracts and pure helpers

**Files:**
- Modify: `package.json`
- Create: `edge-functions/_lib/http.js`
- Create: `edge-functions/_lib/records.js`
- Test: `tests/assistant-backend.test.mjs`

- [ ] **Step 1: Write failing contract tests**

```js
// tests/assistant-backend.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { archiveKey, chatKey, fileKey, retentionState, validateMessage } from "../edge-functions/_lib/records.js";

test("record keys are stable and owner scoped", () => {
  assert.equal(chatKey("owner", "2026-07-13", "m1"), "chat:owner:2026-07-13:m1");
  assert.equal(archiveKey("owner", "2026-07-13"), "archive:owner:2026-07-13");
  assert.equal(fileKey("owner", "f1"), "file:owner:f1");
});

test("messages reject empty or oversized text", () => {
  assert.throws(() => validateMessage(""), /消息不能为空/);
  assert.throws(() => validateMessage("x".repeat(8001)), /8000/);
  assert.equal(validateMessage("你好"), "你好");
});

test("processed records wait seven days and unprocessed records wait thirty", () => {
  const now = Date.parse("2026-07-20T00:00:00Z");
  assert.equal(retentionState({ processedAt: "2026-07-13T00:00:00Z" }, now), "deletable");
  assert.equal(retentionState({ createdAt: "2026-06-20T00:00:00Z" }, now), "expired-unprocessed");
  assert.equal(retentionState({ createdAt: "2026-07-19T00:00:00Z" }, now), "keep");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- --test-name-pattern="record keys|messages reject|processed records"`

Expected: FAIL because `edge-functions/_lib/records.js` does not exist.

- [ ] **Step 3: Implement the contracts**

```js
// edge-functions/_lib/records.js
const DAY = 24 * 60 * 60 * 1000;

export const chatKey = (ownerId, date, messageId) => `chat:${ownerId}:${date}:${messageId}`;
export const archiveKey = (ownerId, date) => `archive:${ownerId}:${date}`;
export const fileKey = (ownerId, fileId) => `file:${ownerId}:${fileId}`;

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
```

```js
// edge-functions/_lib/http.js
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

export async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("请求必须是JSON");
  return request.json();
}

export const errorJson = (error, status = 400) => json({ ok: false, error: error.message }, status);
```

Merge these entries into the existing `package.json`; retain `validate:today` and every pre-existing script:

```json
{
  "name": "yuan-personal-assistant",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:backend": "node --test tests/assistant-backend.test.mjs",
    "validate:today": "node scripts/validate-today.mjs",
    "token:codex": "node scripts/generate-codex-token.mjs"
  },
  "dependencies": {
    "@edgeone/pages-blob": "latest",
    "@edgeone/pages-kv": "latest"
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm install && npm run test:backend`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json edge-functions/_lib/http.js edge-functions/_lib/records.js tests/assistant-backend.test.mjs
git commit -m "feat: add assistant backend contracts"
```

### Task 2: Implement signed device and Codex authentication

**Files:**
- Create: `edge-functions/_lib/crypto.js`
- Create: `edge-functions/api/auth.js`
- Modify: `tests/assistant-backend.test.mjs`

- [ ] **Step 1: Add failing token tests**

```js
import { issueToken, verifyToken } from "../edge-functions/_lib/crypto.js";

test("signed tokens round trip and reject tampering", async () => {
  const token = await issueToken({ sub: "owner", kind: "device", exp: 200 }, "secret", 100);
  assert.equal((await verifyToken(token, "secret", 150)).sub, "owner");
  await assert.rejects(() => verifyToken(`${token}x`, "secret", 150), /无效/);
  await assert.rejects(() => verifyToken(token, "secret", 201), /过期/);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:backend`

Expected: FAIL because `crypto.js` does not exist.

- [ ] **Step 3: Implement Web Crypto tokens and login endpoint**

```js
// edge-functions/_lib/crypto.js
const encoder = new TextEncoder();
const b64 = (value) => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const unb64 = (value) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function key(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sha256(value) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function sha256Bytes(value) {
  return b64(await crypto.subtle.digest("SHA-256", value));
}

export async function issueToken(payload, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const body = b64(encoder.encode(JSON.stringify({ iat: nowSeconds, ...payload })));
  const signature = b64(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)));
  return `${body}.${signature}`;
}

export async function verifyToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [body, signature] = String(token).split(".");
  if (!body || !signature || !await crypto.subtle.verify("HMAC", await key(secret), unb64(signature), encoder.encode(body))) throw new Error("访问令牌无效");
  const payload = JSON.parse(new TextDecoder().decode(unb64(body)));
  if (payload.exp <= nowSeconds) throw new Error("访问令牌已过期");
  return payload;
}
```

```js
// edge-functions/api/auth.js
import { issueToken, sha256, verifyToken } from "../_lib/crypto.js";
import { errorJson, json, readJson } from "../_lib/http.js";

export default async function onRequest({ request, env }) {
  try {
    if (request.method === "POST") {
      const { accessCode, deviceName = "手机" } = await readJson(request);
      if (await sha256(accessCode) !== env.OWNER_ACCESS_CODE_HASH) return errorJson(new Error("访问码错误"), 401);
      const now = Math.floor(Date.now() / 1000);
      const token = await issueToken({ sub: "owner", kind: "device", deviceName, exp: now + 90 * 86400 }, env.SESSION_SECRET, now);
      return json({ ok: true, token, expiresInDays: 90 });
    }
    if (request.method === "DELETE") return json({ ok: true });
    return errorJson(new Error("方法不支持"), 405);
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function requireAuth(request, env, kind = "device") {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = await verifyToken(token, env.SESSION_SECRET);
  if (payload.kind !== kind) throw new Error("权限不足");
  return payload;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:backend`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add edge-functions/_lib/crypto.js edge-functions/api/auth.js tests/assistant-backend.test.mjs
git commit -m "feat: add device and codex authentication"
```

### Task 3: Implement chat, model, memory and controlled search

**Files:**
- Create: `edge-functions/_lib/storage.js`
- Create: `edge-functions/_lib/model.js`
- Create: `edge-functions/_lib/search.js`
- Create: `edge-functions/api/chat.js`
- Modify: `tests/assistant-backend.test.mjs`

- [ ] **Step 1: Add failing search-policy and prompt tests**

```js
import { needsSearch } from "../edge-functions/_lib/search.js";
import { buildModelMessages } from "../edge-functions/_lib/model.js";

test("search is controlled by intent and user override", () => {
  assert.equal(needsSearch("请联网查今天的新闻"), true);
  assert.equal(needsSearch("不要联网，只根据你记得的回答"), false);
  assert.equal(needsSearch("我今天心情不好"), false);
  assert.equal(needsSearch("现在DeepSeek价格是多少"), true);
});

test("model context includes compact memory but not unrelated archive", () => {
  const messages = buildModelMessages({ memory: "沟通偏好：直接", history: [{ role: "user", content: "你好" }], userText: "继续" });
  assert.match(messages[0].content, /沟通偏好：直接/);
  assert.equal(messages.at(-1).content, "继续");
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:backend`

Expected: FAIL because the model/search modules do not exist.

- [ ] **Step 3: Implement policies and adapters**

```js
// edge-functions/_lib/search.js
const currentInfo = /(今天|最新|现在|价格|新闻|政策|天气|汇率|版本)/;
export function needsSearch(text) {
  if (/不要联网|不用搜索/.test(text)) return false;
  if (/联网查|搜索一下|网上查/.test(text)) return true;
  return currentInfo.test(text);
}

export async function searchWeb(query, env) {
  if (!env.SEARCH_ENDPOINT) return [];
  const response = await fetch(env.SEARCH_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.SEARCH_API_KEY}` },
    body: JSON.stringify({ query, limit: 5 }),
  });
  if (!response.ok) throw new Error("联网搜索暂时不可用");
  return (await response.json()).results ?? [];
}
```

```js
// edge-functions/_lib/model.js
export function buildModelMessages({ memory = "", history = [], userText, sources = [] }) {
  const sourceText = sources.map((item, index) => `[${index + 1}] ${item.title} ${item.url}\n${item.snippet}`).join("\n");
  return [
    { role: "system", content: `你是缘的私人网页助手。回答直接、清楚。长期记忆：\n${memory || "暂无"}\n联网资料：\n${sourceText || "未联网"}` },
    ...history.slice(-30),
    { role: "user", content: userText },
  ];
}

export function buildArchiveMessages(history, date) {
  return [
    { role: "system", content: "把当天对话整理成简洁Markdown。只保留事实、决定、感受、计划和待跟进事项；不要编造。标题必须包含日期。" },
    { role: "user", content: `日期：${date}\n\n${history.map(({ role, content }) => `${role}: ${content}`).join("\n")}` },
  ];
}

export async function callModel(messages, env) {
  const response = await fetch(env.MODEL_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.MODEL_API_KEY}` },
    body: JSON.stringify({ model: env.MODEL_NAME, messages, stream: false }),
  });
  if (!response.ok) throw new Error("AI暂时无法回答");
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? data.output_text ?? "";
}
```

```js
// edge-functions/_lib/storage.js
import { getKV } from "@edgeone/pages-kv";
import { getStore } from "@edgeone/pages-blob";

export const kv = () => getKV("yuan-assistant");
export const blob = () => getStore("yuan-assistant-files");

export async function listJson(prefix) {
  const store = kv();
  const listed = await store.list({ prefix });
  const values = await Promise.all((listed.keys ?? []).map(async ({ name }) => JSON.parse(await store.get(name))));
  return values.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
```

```js
// edge-functions/api/chat.js
import { requireAuth } from "./auth.js";
import { json, errorJson, readJson } from "../_lib/http.js";
import { archiveKey, chatKey, validateMessage } from "../_lib/records.js";
import { kv, listJson } from "../_lib/storage.js";
import { buildArchiveMessages, buildModelMessages, callModel } from "../_lib/model.js";
import { needsSearch, searchWeb } from "../_lib/search.js";

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env);
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    if (request.method === "GET") {
      const versions = JSON.parse(await kv().get(`memory:${owner.sub}:index`) || "[]");
      const archive = JSON.parse(await kv().get(archiveKey(owner.sub, date)) || "null");
      return json({ ok: true, messages: await listJson(`chat:${owner.sub}:${date}:`), memory: versions[0] || null, archive });
    }
    const action = url.searchParams.get("action") || "send";
    const body = await readJson(request);
    if (action === "archive-preview" || action === "archive-direct") {
      const archiveDate = body.date || date;
      const history = await listJson(`chat:${owner.sub}:${archiveDate}:`);
      if (!history.length) throw new Error("今天还没有可以整理的对话");
      const document = await callModel(buildArchiveMessages(history, archiveDate), env);
      if (action === "archive-preview") return json({ ok: true, document });
      const record = {
        id: `chat-${archiveDate}`,
        kind: "chat-archive",
        date: archiveDate,
        content: document,
        messageIds: history.map((item) => item.id),
        createdAt: new Date().toISOString(),
        status: "waiting",
      };
      await kv().put(archiveKey(owner.sub, archiveDate), JSON.stringify(record));
      return json({ ok: true, archive: record });
    }
    const { text, clientMessageId } = body;
    const userText = validateMessage(text);
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientMessageId || "")) throw new Error("消息编号无效");
    const existing = await kv().get(chatKey(owner.sub, date, clientMessageId));
    if (existing) return json({ ok: true, duplicate: true, messages: [JSON.parse(existing)] });
    const history = await listJson(`chat:${owner.sub}:${date}:`);
    const memory = await kv().get(`memory:${owner.sub}:latest`) || "";
    const sources = needsSearch(userText) ? await searchWeb(userText, env) : [];
    const createdAt = new Date().toISOString();
    const userRecord = { id: clientMessageId, role: "user", content: userText, date, createdAt, sources: [] };
    await kv().put(chatKey(owner.sub, date, userRecord.id), JSON.stringify(userRecord));
    const answer = await callModel(buildModelMessages({ memory, history, userText, sources }), env);
    const assistantRecord = { id: crypto.randomUUID(), role: "assistant", content: answer, date, createdAt: new Date().toISOString(), sources };
    await kv().put(chatKey(owner.sub, date, assistantRecord.id), JSON.stringify(assistantRecord));
    return json({ ok: true, messages: [userRecord, assistantRecord] });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:backend`

Expected: all backend tests PASS.

- [ ] **Step 5: Commit**

```bash
git add edge-functions/_lib/storage.js edge-functions/_lib/model.js edge-functions/_lib/search.js edge-functions/api/chat.js tests/assistant-backend.test.mjs
git commit -m "feat: add synchronized AI chat backend"
```

### Task 4: Implement temporary files, Codex transfer and cleanup

**Files:**
- Create: `edge-functions/api/files.js`
- Create: `edge-functions/api/codex.js`
- Create: `edge-functions/api/cleanup.js`
- Modify: `tests/assistant-backend.test.mjs`

- [ ] **Step 1: Add failing cleanup selection test**

```js
import { selectDeletable } from "../edge-functions/api/cleanup.js";

test("cleanup selects only processed records past retention", () => {
  const now = Date.parse("2026-07-21T00:00:00Z");
  const selected = selectDeletable([
    { id: "old", processedAt: "2026-07-13T00:00:00Z" },
    { id: "new", processedAt: "2026-07-20T00:00:00Z" },
    { id: "kept", processedAt: "2026-07-01T00:00:00Z", keep: true },
  ], now);
  assert.deepEqual(selected.map((item) => item.id), ["old"]);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:backend`

Expected: FAIL because cleanup module does not exist.

- [ ] **Step 3: Implement upload/list, Codex pull/ack/memory, and deletion**

```js
// edge-functions/api/files.js
import { requireAuth } from "./auth.js";
import { blob, kv, listJson } from "../_lib/storage.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { fileKey } from "../_lib/records.js";
import { sha256Bytes } from "../_lib/crypto.js";

export default async function onRequest({ request, env }) {
  try {
    const owner = await requireAuth(request, env);
    if (request.method === "GET") return json({ ok: true, files: await listJson(`file:${owner.sub}:`) });
    if (request.method === "PATCH") {
      const { id, action } = await readJson(request);
      const key = fileKey(owner.sub, id);
      const record = JSON.parse(await kv().get(key) || "null");
      if (!record) throw new Error("文件不存在");
      if (action === "delete") { await blob().delete(record.blobKey); await kv().delete(key); return json({ ok: true }); }
      if (action === "keep") { await kv().put(key, JSON.stringify({ ...record, keep: true })); return json({ ok: true }); }
      if (action === "retry") { await kv().put(key, JSON.stringify({ ...record, status: "waiting", processedAt: null, keep: false })); return json({ ok: true }); }
      throw new Error("未知文件操作");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error("文件必须小于20MB");
    const id = crypto.randomUUID();
    const blobKey = `${owner.sub}/${id}/${file.name}`;
    const bytes = await file.arrayBuffer();
    const sha256 = await sha256Bytes(bytes);
    await blob().set(blobKey, bytes, { contentType: file.type || "application/octet-stream" });
    const record = { id, blobKey, name: file.name, size: file.size, sha256, type: file.type, createdAt: new Date().toISOString(), status: "waiting" };
    await kv().put(fileKey(owner.sub, id), JSON.stringify(record));
    return json({ ok: true, file: record }, 201);
  } catch (error) {
    return errorJson(error, /令牌/.test(error.message) ? 401 : 400);
  }
}
```

```js
// edge-functions/api/codex.js
import { requireAuth } from "./auth.js";
import { blob, kv, listJson } from "../_lib/storage.js";
import { errorJson, json, readJson } from "../_lib/http.js";
import { archiveKey, fileKey } from "../_lib/records.js";

export default async function onRequest({ request, env }) {
  try {
    await requireAuth(request, env, "codex");
    const action = new URL(request.url).searchParams.get("action") || "pull";
    if (request.method === "GET" && action === "pull") {
      const files = (await listJson("file:owner:")).filter((item) => item.status === "waiting").map((item) => ({ ...item, kind: "file" }));
      const archives = (await listJson("archive:owner:")).filter((item) => item.status === "waiting");
      return json({ ok: true, items: [...files, ...archives].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    }
    const body = await readJson(request);
    if (action === "download") {
      const record = JSON.parse(await kv().get(fileKey("owner", body.id)) || "null");
      if (!record) throw new Error("文件不存在");
      return new Response(await blob().get(record.blobKey, { consistency: "strong" }));
    }
    if (action === "ack") {
      const key = body.kind === "chat-archive" ? archiveKey("owner", body.date) : fileKey("owner", body.id);
      const record = JSON.parse(await kv().get(key));
      await kv().put(key, JSON.stringify({ ...record, status: "processed", processedAt: new Date().toISOString(), localPath: body.localPath }));
      return json({ ok: true });
    }
    if (action === "memory") {
      const version = body.version || new Date().toISOString();
      await kv().put(`memory:owner:${version}`, body.content);
      await kv().put("memory:owner:latest", body.content);
      const indexKey = "memory:owner:index";
      const versions = JSON.parse(await kv().get(indexKey) || "[]");
      const next = [{ version, createdAt: new Date().toISOString() }, ...versions.filter((item) => item.version !== version)];
      for (const old of next.slice(7)) await kv().delete(`memory:owner:${old.version}`);
      await kv().put(indexKey, JSON.stringify(next.slice(0, 7)));
      return json({ ok: true, version });
    }
    throw new Error("未知操作");
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
```

```js
// edge-functions/api/cleanup.js
import { requireAuth } from "./auth.js";
import { blob, kv, listJson } from "../_lib/storage.js";
import { retentionState } from "../_lib/records.js";
import { errorJson, json } from "../_lib/http.js";

export const selectDeletable = (records, now = Date.now()) => records.filter((record) => retentionState(record, now) === "deletable");

export default async function onRequest({ request, env }) {
  try {
    await requireAuth(request, env, "codex");
    const fileRecords = await listJson("file:owner:");
    const archiveRecords = await listJson("archive:owner:");
    const selectedFiles = selectDeletable(fileRecords);
    const selectedArchives = selectDeletable(archiveRecords);
    for (const record of selectedFiles) {
      await blob().delete(record.blobKey);
      await kv().delete(`file:owner:${record.id}`);
    }
    for (const record of selectedArchives) {
      for (const messageId of record.messageIds) await kv().delete(`chat:owner:${record.date}:${messageId}`);
      await kv().delete(`archive:owner:${record.date}`);
    }
    return json({ ok: true, deleted: [...selectedFiles, ...selectedArchives].map((item) => item.id) });
  } catch (error) {
    return errorJson(error, /令牌|权限/.test(error.message) ? 401 : 400);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:backend`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add edge-functions/api/files.js edge-functions/api/codex.js edge-functions/api/cleanup.js tests/assistant-backend.test.mjs
git commit -m "feat: add temporary file transfer and cleanup"
```

### Task 5: Configure and deploy EdgeOne Makers

**Files:**
- Create: `docs/edgeone-setup.md`
- Create: `scripts/generate-codex-token.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Document exact console resources and secrets**

```markdown
# EdgeOne Makers setup

1. Create a Makers project from the GitHub repository.
2. Confirm the project discovers `edge-functions/api`.
3. Create KV namespace `yuan-assistant`.
4. Create Blob store `yuan-assistant-files`.
5. Add secrets: `OWNER_ACCESS_CODE_HASH`, `SESSION_SECRET`, `MODEL_ENDPOINT`, `MODEL_API_KEY`, `MODEL_NAME`, `SEARCH_ENDPOINT`, `SEARCH_API_KEY`.
6. Set the same `SESSION_SECRET` temporarily in the local terminal, run `npm run token:codex`, copy the resulting token into the local secret store, and then clear `SESSION_SECRET` from the terminal session.
7. Deploy and note the Makers project URL.
8. Do not add any secret value to GitHub Actions, source files, screenshots, or knowledge-base notes.
9. If a phone is lost, replace `SESSION_SECRET` in EdgeOne and generate a new Codex token; this immediately invalidates every old phone and computer token, after which the two retained phones log in again with the access code.
```

- [ ] **Step 2: Add the local Codex-token generator**

```js
// scripts/generate-codex-token.mjs
import { issueToken } from "../edge-functions/_lib/crypto.js";

if (!process.env.SESSION_SECRET) throw new Error("缺少 SESSION_SECRET");
const now = Math.floor(Date.now() / 1000);
const token = await issueToken({ sub: "owner", kind: "codex", exp: now + 365 * 86400 }, process.env.SESSION_SECRET, now);
process.stdout.write(`${token}\n`);
```

- [ ] **Step 3: Ignore local secret files**

Append to `.gitignore`:

```gitignore
.env
.env.*
!.env.example
.assistant-secrets/
```

- [ ] **Step 4: Verify locally**

Run: `npx edgeone makers dev`

Expected: local server starts and `/api/auth` responds with JSON rather than 404.

- [ ] **Step 5: Verify deployed health manually**

Run: `curl -i https://<edgeone-project-domain>/api/auth`

Expected: `405` JSON response with `{"ok":false,"error":"方法不支持"}`; no stack trace or secret values.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: all existing ledger/task/history/weekly tests and backend tests PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/edgeone-setup.md scripts/generate-codex-token.mjs .gitignore package.json
git commit -m "docs: add EdgeOne assistant deployment setup"
```
