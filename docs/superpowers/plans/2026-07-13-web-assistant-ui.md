# Web Assistant UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-first AI assistant page to the existing PWA with 90-day device login, synchronized daily chat, sources, file upload, daily archive controls, status indicators, and strict separation from the local ledger.

**Architecture:** Focused ESM modules isolate API calls, local session/pending-message storage, pure view-model formatting, and DOM wiring. The existing bottom navigation gains a fourth view; the ledger modules remain unchanged and are never imported by assistant code.

**Tech Stack:** HTML, CSS, vanilla JavaScript ESM, IndexedDB/localStorage, Node test runner, existing PWA service worker.

---

## File map

- Modify: `index.html` — assistant view, login dialog, bottom navigation.
- Modify: `styles.css` — mobile chat, source cards, upload/status styles.
- Modify: `js/app.js` — initialize assistant without exposing ledger state.
- Create: `js/assistant-api.js` — authenticated HTTP client.
- Create: `js/assistant-store.js` — local session and pending-message queue.
- Create: `js/assistant-view.js` — pure formatting helpers.
- Create: `js/assistant-ui.js` — DOM behavior.
- Create: `tests/assistant-ui.test.mjs` — store/view tests.
- Modify: `service-worker.js` — cache new modules and bump cache key.
- Modify: `README.md` — privacy/data-flow explanation.

### Task 1: Add assistant local state and view models

**Files:**
- Create: `js/assistant-store.js`
- Create: `js/assistant-view.js`
- Create: `tests/assistant-ui.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// tests/assistant-ui.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../js/assistant-store.js";
import { formatMessage, groupMessagesByDate } from "../js/assistant-view.js";

test("pending messages survive until acknowledged", () => {
  const store = createMemoryStore();
  store.enqueue({ id: "m1", text: "你好" });
  assert.equal(store.pending().length, 1);
  store.ack("m1");
  assert.equal(store.pending().length, 0);
});

test("message view exposes sources without injecting html", () => {
  const view = formatMessage({ role: "assistant", content: "<b>答案</b>", sources: [{ title: "来源", url: "https://example.com" }] });
  assert.equal(view.content, "<b>答案</b>");
  assert.deepEqual(view.sources, [{ title: "来源", url: "https://example.com" }]);
});

test("messages are grouped by their explicit date", () => {
  assert.deepEqual(Object.keys(groupMessagesByDate([{ date: "2026-07-13" }, { date: "2026-07-14" }])), ["2026-07-13", "2026-07-14"]);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/assistant-ui.test.mjs`

Expected: FAIL because the assistant modules do not exist.

- [ ] **Step 3: Implement pure state and view helpers**

```js
// js/assistant-store.js
export function createMemoryStore(initial = {}) {
  const state = { token: initial.token ?? null, pending: [...(initial.pending ?? [])] };
  return {
    token: () => state.token,
    setToken: (token) => { state.token = token; },
    enqueue: (message) => { state.pending.push(message); },
    pending: () => [...state.pending],
    ack: (id) => { state.pending = state.pending.filter((item) => item.id !== id); },
  };
}

export function createBrowserStore(storage = localStorage) {
  const load = () => JSON.parse(storage.getItem("yuan-assistant-session") || "{}");
  const save = (value) => storage.setItem("yuan-assistant-session", JSON.stringify(value));
  return {
    token: () => load().token ?? null,
    setToken(token) { save({ ...load(), token }); },
    clearToken() { save({ ...load(), token: null }); },
    pending: () => load().pending ?? [],
    enqueue(message) { save({ ...load(), pending: [...(load().pending ?? []), message] }); },
    ack(id) { save({ ...load(), pending: (load().pending ?? []).filter((item) => item.id !== id) }); },
  };
}
```

```js
// js/assistant-view.js
export const formatMessage = (message) => ({
  id: message.id,
  role: message.role,
  content: String(message.content ?? ""),
  createdAt: message.createdAt,
  sources: (message.sources ?? []).map(({ title, url }) => ({ title, url })),
});

export function groupMessagesByDate(messages) {
  return messages.reduce((groups, message) => {
    (groups[message.date] ||= []).push(message);
    return groups;
  }, {});
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/assistant-ui.test.mjs`

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/assistant-store.js js/assistant-view.js tests/assistant-ui.test.mjs
git commit -m "feat: add assistant client state"
```

### Task 2: Add the authenticated API client

**Files:**
- Create: `js/assistant-api.js`
- Modify: `tests/assistant-ui.test.mjs`

- [ ] **Step 1: Add failing request tests**

```js
import { createAssistantApi } from "../js/assistant-api.js";

test("api client adds bearer token and serializes messages", async () => {
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
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/assistant-ui.test.mjs`

Expected: FAIL because `assistant-api.js` does not exist.

- [ ] **Step 3: Implement the client**

```js
// js/assistant-api.js
export function createAssistantApi({ baseUrl, getToken, fetchImpl = fetch }) {
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: { ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }), authorization: `Bearer ${getToken() || ""}`, ...options.headers },
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "请求失败");
      error.status = response.status;
      throw error;
    }
    return data;
  };
  return {
    login: (accessCode, deviceName) => request("/api/auth", { method: "POST", body: JSON.stringify({ accessCode, deviceName }) }),
    listMessages: (date) => request(`/api/chat?date=${encodeURIComponent(date)}`),
    sendMessage: (text, date, clientMessageId) => request(`/api/chat?date=${encodeURIComponent(date)}`, { method: "POST", body: JSON.stringify({ text, clientMessageId }) }),
    listFiles: () => request("/api/files"),
    uploadFile: (formData) => request("/api/files", { method: "POST", body: formData }),
    updateFile: (id, action) => request("/api/files", { method: "PATCH", body: JSON.stringify({ id, action }) }),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/assistant-ui.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/assistant-api.js tests/assistant-ui.test.mjs
git commit -m "feat: add assistant API client"
```

### Task 3: Add the assistant view and navigation

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `js/app.js`
- Create: `js/assistant-ui.js`

- [ ] **Step 1: Add the assistant markup**

Insert before `</main>` in `index.html`:

```html
<section id="assistant-view" class="view assistant-view" aria-labelledby="assistant-tab" hidden>
  <header class="assistant-heading">
    <div><p class="eyebrow">私人 AI 助手</p><h2>今天的对话</h2></div>
    <button id="assistant-lock" class="text-button" type="button">锁定</button>
  </header>
  <p id="assistant-status" class="assistant-status" role="status">正在连接…</p>
  <p id="assistant-memory-status" class="assistant-status">记忆包：尚未读取</p>
  <p id="assistant-archive-status" class="assistant-status">今日对话：尚未归档</p>
  <div id="assistant-messages" class="assistant-messages" aria-live="polite"></div>
  <details class="assistant-transfer"><summary>临时中转资料</summary><div id="assistant-files"></div></details>
  <section class="assistant-archive-actions">
    <button id="assistant-preview-archive" class="secondary" type="button">查看今日整理</button>
    <button id="assistant-direct-archive" class="secondary" type="button">直接归档并休息</button>
  </section>
  <form id="assistant-form" class="assistant-composer">
    <label class="sr-only" for="assistant-input">给助手发送消息</label>
    <textarea id="assistant-input" rows="2" maxlength="8000" placeholder="和助手说点什么…" required></textarea>
    <label class="assistant-upload">添加文件<input id="assistant-file" type="file" accept="image/*,.pdf,.doc,.docx,.md,.txt" hidden></label>
    <button class="primary" type="submit">发送</button>
  </form>
</section>

<dialog id="assistant-login-dialog">
  <form id="assistant-login-form">
    <div class="dialog-head"><h2>打开私人助手</h2></div>
    <label>专属访问码<input id="assistant-access-code" type="password" autocomplete="current-password" required></label>
    <label>这台设备的名称<input id="assistant-device-name" value="我的手机" maxlength="30" required></label>
    <button class="primary" type="submit">进入助手</button>
  </form>
</dialog>
```

Add to the bottom navigation:

```html
<button id="assistant-tab" data-view="assistant-view"><span aria-hidden="true">✦</span>助手</button>
```

- [ ] **Step 2: Add focused mobile CSS**

Append to `styles.css`:

```css
.assistant-view{min-height:calc(100vh - 150px);padding-bottom:150px}.assistant-heading,.assistant-composer{display:flex;align-items:center;gap:10px}.assistant-heading{justify-content:space-between}.assistant-status{font-size:.85rem;color:#68706a}.assistant-messages{display:grid;gap:12px;margin:16px 0}.assistant-message{max-width:88%;padding:12px 14px;border-radius:18px;white-space:pre-wrap;overflow-wrap:anywhere}.assistant-message.user{justify-self:end;background:#263d34;color:#fff}.assistant-message.assistant{justify-self:start;background:#fff;border:1px solid #e4e6e1}.assistant-sources{display:grid;gap:4px;margin-top:8px;font-size:.8rem}.assistant-transfer{margin:12px 0}.assistant-file-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:10px 0;border-bottom:1px solid #e4e6e1}.assistant-file-actions{display:flex;gap:6px;flex-wrap:wrap}.assistant-archive-actions{display:flex;gap:8px;flex-wrap:wrap}.assistant-composer{position:fixed;left:0;right:0;bottom:64px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:#f7f7f5;border-top:1px solid #dedfd9;z-index:5}.assistant-composer textarea{flex:1;resize:none;min-height:44px}.assistant-upload{font-size:.82rem;color:#405b50;cursor:pointer}@media(min-width:760px){.assistant-composer{left:50%;max-width:760px;transform:translateX(-50%)}}
```

- [ ] **Step 3: Implement DOM behavior**

```js
// js/assistant-ui.js
import { createAssistantApi } from "./assistant-api.js";
import { createBrowserStore } from "./assistant-store.js";
import { formatMessage } from "./assistant-view.js";

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

export function initAssistant({ baseUrl }) {
  const store = createBrowserStore();
  const api = createAssistantApi({ baseUrl, getToken: store.token });
  const dialog = document.querySelector("#assistant-login-dialog");
  const status = document.querySelector("#assistant-status");
  const list = document.querySelector("#assistant-messages");
  const fileList = document.querySelector("#assistant-files");
  const memoryStatus = document.querySelector("#assistant-memory-status");
  const archiveStatus = document.querySelector("#assistant-archive-status");

  const render = (messages) => {
    list.replaceChildren(...messages.map((raw) => {
      const message = formatMessage(raw);
      const article = document.createElement("article");
      article.className = `assistant-message ${message.role}`;
      const text = document.createElement("div");
      text.textContent = message.content;
      article.append(text);
      if (message.sources.length) {
        const sources = document.createElement("div");
        sources.className = "assistant-sources";
        for (const source of message.sources) {
          const link = document.createElement("a");
          const url = new URL(source.url);
          if (!/^https?:$/.test(url.protocol)) continue;
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = source.title;
          sources.append(link);
        }
        article.append(sources);
      }
      return article;
    }));
  };

  const renderFiles = (files) => {
    fileList.replaceChildren(...files.map((file) => {
      const row = document.createElement("div"); row.className = "assistant-file-row";
      const label = document.createElement("span"); label.textContent = `${file.name} · ${file.status}`;
      const actions = document.createElement("div"); actions.className = "assistant-file-actions";
      for (const [action, text] of [["keep", "长期保留"], ["retry", "重新处理"], ["delete", "立即删除"]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "text-button"; button.textContent = text;
        button.addEventListener("click", async () => { await api.updateFile(file.id, action); await refresh(); });
        actions.append(button);
      }
      row.append(label, actions); return row;
    }));
  };

  const refresh = async () => {
    if (!store.token()) return dialog.showModal();
    try {
      const [data, fileData] = await Promise.all([api.listMessages(today()), api.listFiles()]);
      render(data.messages); renderFiles(fileData.files);
      memoryStatus.textContent = data.memory ? `记忆包：${data.memory.version}，更新于 ${data.memory.createdAt}` : "记忆包：尚未上传";
      archiveStatus.textContent = data.archive ? `今日对话：${data.archive.status}` : "今日对话：尚未归档";
      status.textContent = "两台手机已同步";
    }
    catch { store.clearToken(); dialog.showModal(); }
  };

  document.querySelector("#assistant-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = await api.login(document.querySelector("#assistant-access-code").value, document.querySelector("#assistant-device-name").value);
    store.setToken(data.token); dialog.close(); await refresh();
  });

  document.querySelector("#assistant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#assistant-input");
    const localId = crypto.randomUUID();
    store.enqueue({ id: localId, text: input.value });
    status.textContent = "正在发送…";
    await api.sendMessage(input.value, today(), localId);
    store.ack(localId); input.value = ""; await refresh();
  });

  document.querySelector("#assistant-file").addEventListener("change", async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const form = new FormData(); form.append("file", file);
    status.textContent = "正在上传…"; await api.uploadFile(form); status.textContent = "文件已进入临时中转箱";
  });

  document.querySelector("#assistant-lock").addEventListener("click", () => { store.clearToken(); dialog.showModal(); });
  return refresh();
}
```

Modify `js/app.js`:

```js
import { initAssistant } from "./assistant-ui.js";
import { initLedger } from "./ledger-ui.js";
import { loadPlan } from "./tasks.js";
import { initReview } from "./review-ui.js";
const assistantBaseUrl = document.documentElement.dataset.assistantApi || location.origin;
const planResult = await Promise.allSettled([loadPlan(document.querySelector("#today-view")), initLedger(), initAssistant({ baseUrl: assistantBaseUrl })]);
await initReview(planResult[0].status === "fulfilled" ? planResult[0].value : null);
```

- [ ] **Step 4: Run existing and assistant tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css js/app.js js/assistant-ui.js
git commit -m "feat: add mobile AI assistant page"
```

### Task 4: Add archive commands and resilient pending-message replay

**Files:**
- Modify: `js/assistant-api.js`
- Modify: `js/assistant-ui.js`
- Modify: `js/assistant-store.js`
- Modify: `tests/assistant-ui.test.mjs`

- [ ] **Step 1: Add failing replay test**

```js
test("pending queue is replayed in insertion order", () => {
  const store = createMemoryStore();
  store.enqueue({ id: "client-00000001", text: "一", date: "2026-07-13" });
  store.enqueue({ id: "client-00000002", text: "二", date: "2026-07-13" });
  assert.deepEqual(store.pending().map((item) => item.text), ["一", "二"]);
});
```

- [ ] **Step 2: Add API methods**

Extend the object returned by `createAssistantApi`:

```js
previewArchive: (date) => request("/api/chat?action=archive-preview", { method: "POST", body: JSON.stringify({ date }) }),
directArchive: (date) => request("/api/chat?action=archive-direct", { method: "POST", body: JSON.stringify({ date }) }),
```

- [ ] **Step 3: Wire the two buttons**

Add in `initAssistant`; the same client message ID is reused on every retry, so the backend cannot create duplicates:

```js
const flushPending = async () => {
  for (const message of store.pending()) {
    await api.sendMessage(message.text, message.date, message.id);
    store.ack(message.id);
  }
};

document.querySelector("#assistant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#assistant-input");
  const message = { id: crypto.randomUUID(), text: input.value, date: today() };
  store.enqueue(message);
  input.value = "";
  status.textContent = "正在发送…";
  try {
    await flushPending();
    await refresh();
  } catch {
    status.textContent = "网络暂时不可用，消息已留在本机，恢复后会自动发送";
  }
});

document.querySelector("#assistant-preview-archive").addEventListener("click", async () => {
  const result = await api.previewArchive(today());
  const accepted = confirm(`${result.document}\n\n确认归档吗？`);
  if (accepted) await api.directArchive(today());
});
document.querySelector("#assistant-direct-archive").addEventListener("click", async () => {
  await api.directArchive(today());
  status.textContent = "今天已经归档，可以休息了";
});
```

Replace the original submit listener from Task 3 with this listener. At the beginning of `refresh`, after confirming a token exists, call `await flushPending()` inside the `try` block before `listMessages`. In the refresh error handler, clear the token only when `error.status === 401`; for network errors retain the token and pending queue.

- [ ] **Step 4: Run tests and manually verify offline queue**

Run: `npm test`

Expected: all tests PASS.

Manual: disable network, send a message, restore network, reopen assistant; pending message remains visible until the server acknowledges it.

- [ ] **Step 5: Commit**

```bash
git add js/assistant-api.js js/assistant-ui.js js/assistant-store.js tests/assistant-ui.test.mjs
git commit -m "feat: add daily archive and resilient chat queue"
```

### Task 5: Update PWA cache and privacy documentation

**Files:**
- Modify: `service-worker.js`
- Modify: `README.md`

- [ ] **Step 1: Bump cache and add assistant files**

Change `CACHE` to `yuan-assistant-v5` and add:

```js
"./js/assistant-api.js",
"./js/assistant-store.js",
"./js/assistant-view.js",
"./js/assistant-ui.js"
```

- [ ] **Step 2: Document privacy boundaries**

Add to `README.md`:

```markdown
## AI 助手数据边界

- 两台手机只同步 AI 聊天和临时中转资料。
- 账本、预算和任务历史仍只保存在各自浏览器本地。
- 原始聊天和临时文件保存在 EdgeOne，处理成功后保留 7 天再删除。
- 完整本地知识库不会上传；网页 AI 只读取 Codex 生成的精简记忆包。
- 联网搜索只发送当前问题的精简查询词，并显示主要来源。
```

- [ ] **Step 3: Run tests and local PWA check**

Run: `npm test && npx serve . -l 4173`

Expected: tests PASS; assistant tab loads on mobile viewport; ledger still displays existing local records.

- [ ] **Step 4: Commit**

```bash
git add service-worker.js README.md
git commit -m "docs: document assistant privacy and cache assets"
```
