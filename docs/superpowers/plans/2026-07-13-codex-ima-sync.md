# Codex EdgeOne and IMA Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WorkBuddy with a local Codex sync pipeline that downloads EdgeOne inbox items, verifies and organizes them into `D:\缘的成长知识库`, uploads compact memory to EdgeOne, and publishes approved formal documents to IMA.

**Architecture:** A Node ESM command uses explicit clients for EdgeOne and IMA, a JSON sync state for idempotency, and a deterministic organizer that writes originals to an inbox before producing formal Markdown. Secrets come only from environment variables or local secret files excluded from Git.

**Tech Stack:** Node.js ESM, built-in `fetch`, `node:fs/promises`, Node test runner, EdgeOne JSON API, IMA OpenAPI, Codex local automation.

---

## File map

- Create: `scripts/assistant-sync/config.mjs` — validated local configuration.
- Create: `scripts/assistant-sync/edgeone-client.mjs` — pull/download/ack/memory/cleanup calls.
- Create: `scripts/assistant-sync/ima-client.mjs` — IMA note and knowledge-base calls.
- Create: `scripts/assistant-sync/state.mjs` — atomic idempotency state.
- Create: `scripts/assistant-sync/organize.mjs` — safe paths and formal Markdown output.
- Create: `scripts/assistant-sync/run.mjs` — orchestration command.
- Create: `tests/assistant-sync.test.mjs` — client/state/organizer tests.
- Create: `.env.example` — variable names only.
- Modify: `package.json` — sync scripts.
- Modify: `.gitignore` — local secrets and sync state.
- Create: `docs/assistant-sync-operations.md` — runbook and WorkBuddy cutover.

### Task 1: Add validated configuration and atomic sync state

**Files:**
- Create: `scripts/assistant-sync/config.mjs`
- Create: `scripts/assistant-sync/state.mjs`
- Create: `tests/assistant-sync.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing tests**

```js
// tests/assistant-sync.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../scripts/assistant-sync/config.mjs";
import { openState } from "../scripts/assistant-sync/state.mjs";

test("config requires endpoints, tokens and knowledge root", () => {
  assert.throws(() => loadConfig({}), /EDGEONE_API_URL/);
});

test("sync state persists processed ids atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yuan-sync-"));
  const state = await openState(join(dir, "state.json"));
  await state.markReceived("item-1", { localPath: "x.md" });
  assert.equal(state.hasReceived("item-1"), true);
  assert.equal(state.isProcessed("item-1"), false);
  await state.markProcessed("item-1", { formalPath: "daily.md" });
  assert.equal(state.isProcessed("item-1"), true);
  assert.match(await readFile(join(dir, "state.json"), "utf8"), /item-1/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/assistant-sync.test.mjs`

Expected: FAIL because config/state modules do not exist.

- [ ] **Step 3: Implement config and state**

```js
// scripts/assistant-sync/config.mjs
export function loadConfig(env = process.env, { requireIma = false } = {}) {
  const required = ["EDGEONE_API_URL", "EDGEONE_CODEX_TOKEN", "YUAN_KB_ROOT", ...(requireIma ? ["IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY", "IMA_KNOWLEDGE_BASE_ID"] : [])];
  for (const name of required) if (!env[name]) throw new Error(`缺少配置 ${name}`);
  return {
    edgeoneApiUrl: env.EDGEONE_API_URL,
    edgeoneToken: env.EDGEONE_CODEX_TOKEN,
    knowledgeRoot: env.YUAN_KB_ROOT,
    imaClientId: env.IMA_OPENAPI_CLIENTID,
    imaApiKey: env.IMA_OPENAPI_APIKEY,
    imaKnowledgeBaseId: env.IMA_KNOWLEDGE_BASE_ID,
    imaFolderId: env.IMA_FOLDER_ID || "",
  };
}
```

```js
// scripts/assistant-sync/state.mjs
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function openState(path) {
  await mkdir(dirname(path), { recursive: true });
  let data = { processed: {} };
  try { data = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const save = async () => {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await rename(temporary, path);
  };
  return {
    hasReceived: (id) => Boolean(data.processed[id]),
    isProcessed: (id) => Boolean(data.processed[id]?.processedAt),
    get: (id) => data.processed[id],
    async markReceived(id, metadata) { data.processed[id] = { ...data.processed[id], ...metadata, receivedAt: new Date().toISOString() }; await save(); },
    async markProcessed(id, metadata) { data.processed[id] = { ...data.processed[id], ...metadata, processedAt: new Date().toISOString() }; await save(); },
  };
}
```

Append to `.gitignore`:

```gitignore
.assistant-secrets/
.assistant-sync-state/
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/assistant-sync.test.mjs`

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/assistant-sync/config.mjs scripts/assistant-sync/state.mjs tests/assistant-sync.test.mjs .gitignore
git commit -m "feat: add assistant sync configuration and state"
```

### Task 2: Implement EdgeOne and IMA clients

**Files:**
- Create: `scripts/assistant-sync/edgeone-client.mjs`
- Create: `scripts/assistant-sync/ima-client.mjs`
- Modify: `tests/assistant-sync.test.mjs`

- [ ] **Step 1: Add failing client tests**

```js
import { createEdgeOneClient } from "../scripts/assistant-sync/edgeone-client.mjs";
import { createImaClient } from "../scripts/assistant-sync/ima-client.mjs";

test("EdgeOne client sends the Codex bearer token", async () => {
  const calls = [];
  const client = createEdgeOneClient("https://edge.example", "secret", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, items: [] }), { headers: { "content-type": "application/json" } });
  });
  await client.pull();
  assert.equal(calls[0].options.headers.authorization, "Bearer secret");
});

test("IMA client writes UTF-8 markdown notes with official headers", async () => {
  const calls = [];
  const client = createImaClient({ clientId: "id", apiKey: "key", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ code: 0, data: { note_id: "n1" } }), { headers: { "content-type": "application/json" } });
  }});
  assert.equal(await client.importNote("# 标题\n\n正文"), "n1");
  assert.equal(calls[0].options.headers["ima-openapi-clientid"], "id");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/assistant-sync.test.mjs`

Expected: FAIL because client modules do not exist.

- [ ] **Step 3: Implement clients**

```js
// scripts/assistant-sync/edgeone-client.mjs
export function createEdgeOneClient(baseUrl, token, fetchImpl = fetch) {
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...options.headers } });
    if (!response.ok) throw new Error(`EdgeOne请求失败: ${response.status}`);
    return response.headers.get("content-type")?.includes("application/json") ? response.json() : response.arrayBuffer();
  };
  return {
    pull: () => request("/api/codex?action=pull"),
    download: (id) => request("/api/codex?action=download", { method: "POST", body: JSON.stringify({ id }) }),
    ack: ({ id, kind, date }, localPath) => request("/api/codex?action=ack", { method: "POST", body: JSON.stringify({ id, kind, date, localPath }) }),
    uploadMemory: (content, version) => request("/api/codex?action=memory", { method: "POST", body: JSON.stringify({ content, version }) }),
    cleanup: () => request("/api/cleanup", { method: "POST", body: "{}" }),
  };
}
```

```js
// scripts/assistant-sync/ima-client.mjs
export function createImaClient({ clientId, apiKey, fetchImpl = fetch }) {
  const post = async (path, body) => {
    const response = await fetchImpl(`https://ima.qq.com${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "ima-openapi-clientid": clientId, "ima-openapi-apikey": apiKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`IMA网络错误: ${response.status}`);
    const data = await response.json();
    if (data.code !== 0) throw new Error(data.msg || `IMA错误 ${data.code}`);
    return data.data;
  };
  return {
    async importNote(markdown, folderId = "") {
      const data = await post("/openapi/note/v1/import_doc", { content_format: 1, content: markdown, ...(folderId ? { folder_id: folderId } : {}) });
      return data.note_id;
    },
    async addNoteToKnowledgeBase({ noteId, title, knowledgeBaseId, folderId = "" }) {
      const data = await post("/openapi/wiki/v1/add_knowledge", { media_type: 11, title, knowledge_base_id: knowledgeBaseId, note_info: { content_id: noteId }, ...(folderId ? { folder_id: folderId } : {}) });
      return data.media_id;
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/assistant-sync.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/assistant-sync/edgeone-client.mjs scripts/assistant-sync/ima-client.mjs tests/assistant-sync.test.mjs
git commit -m "feat: add EdgeOne and IMA sync clients"
```

### Task 3: Implement safe local organization and memory generation

**Files:**
- Create: `scripts/assistant-sync/organize.mjs`
- Modify: `tests/assistant-sync.test.mjs`

- [ ] **Step 1: Add failing path and Markdown tests**

```js
import { safeName, buildDailyDocument, buildMemoryPack } from "../scripts/assistant-sync/organize.mjs";

test("safeName removes Windows path characters", () => {
  assert.equal(safeName('a<b>:c?.md'), "a_b__c_.md");
});

test("daily document keeps source metadata and important sections", () => {
  const markdown = buildDailyDocument({ date: "2026-07-13", summary: "完成方案", decisions: ["使用EdgeOne"], followUps: ["部署"] });
  assert.match(markdown, /# 2026-07-13 每日记录/);
  assert.match(markdown, /使用EdgeOne/);
});

test("memory pack is compact and excludes raw transcripts", () => {
  const pack = buildMemoryPack({ preferences: ["回答直接"], goals: ["完善助手"], status: ["正在部署"], followUps: ["测试双手机"] });
  assert.match(pack, /回答直接/);
  assert.doesNotMatch(pack, /原始聊天/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test tests/assistant-sync.test.mjs`

Expected: FAIL because organizer module does not exist.

- [ ] **Step 3: Implement deterministic builders**

```js
// scripts/assistant-sync/organize.mjs
export const safeName = (name) => name.replace(/[<>:"/\\|?*]/g, "_");
const bullets = (items = []) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";

export function buildDailyDocument({ date, summary, decisions = [], followUps = [], sourceIds = [] }) {
  return `# ${date} 每日记录\n\n## 今日概况\n\n${summary}\n\n## 重要决定\n\n${bullets(decisions)}\n\n## 后续事项\n\n${bullets(followUps)}\n\n## 来源记录\n\n${bullets(sourceIds)}\n`;
}

export function buildMemoryPack({ preferences = [], goals = [], status = [], rules = [], followUps = [] }) {
  return `# 手机助手记忆包\n\n## 沟通偏好\n${bullets(preferences)}\n\n## 当前目标\n${bullets(goals)}\n\n## 近期状态\n${bullets(status)}\n\n## 重要规则\n${bullets(rules)}\n\n## 待跟进\n${bullets(followUps)}\n`;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/assistant-sync.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/assistant-sync/organize.mjs tests/assistant-sync.test.mjs
git commit -m "feat: add safe knowledge organization"
```

### Task 4: Implement the two-phase pull and publish command

**Files:**
- Create: `scripts/assistant-sync/run.mjs`
- Create: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: Create the orchestrator**

```js
// scripts/assistant-sync/run.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { createEdgeOneClient } from "./edgeone-client.mjs";
import { createImaClient } from "./ima-client.mjs";
import { openState } from "./state.mjs";
import { safeName } from "./organize.mjs";

const localDate = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

export async function pull(env = process.env, { edgeFactory = createEdgeOneClient } = {}) {
  const config = loadConfig(env);
  const edge = edgeFactory(config.edgeoneApiUrl, config.edgeoneToken);
  const systemDir = join(config.knowledgeRoot, ".system", "assistant-sync");
  const inboxDir = join(config.knowledgeRoot, "00-inbox", "edgeone待整理");
  const batchDir = join(systemDir, "batches");
  await mkdir(inboxDir, { recursive: true }); await mkdir(batchDir, { recursive: true });
  const state = await openState(join(systemDir, "sync-state.json"));
  const pulled = await edge.pull();
  const batch = { id: `${localDate()}-${Date.now()}`, date: localDate(), createdAt: new Date().toISOString(), items: [] };
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
    batch.items.push({ id: item.id, kind: item.kind, date: item.date || "", localPath });
  }
  const batchPath = join(batchDir, `${batch.id}.json`);
  await writeFile(batchPath, JSON.stringify(batch, null, 2), "utf8");
  return { downloaded: batch.items.length, batchPath };
}

export async function publish(batchPath, env = process.env, { edgeFactory = createEdgeOneClient, imaFactory = createImaClient } = {}) {
  const config = loadConfig(env, { requireIma: true });
  const edge = edgeFactory(config.edgeoneApiUrl, config.edgeoneToken);
  const ima = imaFactory({ clientId: config.imaClientId, apiKey: config.imaApiKey });
  const batch = JSON.parse(await readFile(batchPath, "utf8"));
  const date = batch.date;
  const dailyPath = join(config.knowledgeRoot, "05-projects", "daily-conversations", `${date}.md`);
  const memoryPath = join(config.knowledgeRoot, "05-projects", "mobile-assistant", "手机助手记忆包.md");
  const daily = await readFile(dailyPath, "utf8");
  const memory = await readFile(memoryPath, "utf8");
  await edge.uploadMemory(memory, `${date}-${Date.now()}`);
  const noteId = await ima.importNote(daily, config.imaFolderId);
  await ima.addNoteToKnowledgeBase({ noteId, title: `${date} 每日记录`, knowledgeBaseId: config.imaKnowledgeBaseId, folderId: config.imaFolderId });
  const state = await openState(join(config.knowledgeRoot, ".system", "assistant-sync", "sync-state.json"));
  for (const item of batch.items) {
    await edge.ack(item, dailyPath);
    await state.markProcessed(item.id, { formalPath: dailyPath, imaNoteId: noteId });
  }
  await edge.cleanup();
  return { processed: batch.items.length, dailyPath, memoryPath, noteId };
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  const [command = "pull", batchPath] = process.argv.slice(2);
  const operation = command === "pull" ? pull() : command === "publish" && batchPath ? publish(batchPath) : Promise.reject(new Error("用法：run.mjs pull 或 run.mjs publish <batchPath>"));
  operation.then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
```

Create `.env.example`:

```dotenv
EDGEONE_API_URL=https://your-project.example
EDGEONE_CODEX_TOKEN=
YUAN_KB_ROOT=D:\缘的成长知识库
IMA_OPENAPI_CLIENTID=
IMA_OPENAPI_APIKEY=
IMA_KNOWLEDGE_BASE_ID=
IMA_FOLDER_ID=
```

Merge these scripts into the existing `package.json`; do not replace `validate:today`, backend tests, or UI tests:

```json
"sync:assistant": "node scripts/assistant-sync/run.mjs pull",
"sync:assistant:publish": "node scripts/assistant-sync/run.mjs publish",
"test:sync": "node --test tests/assistant-sync.test.mjs"
```

- [ ] **Step 2: Run unit tests**

Run: `npm run test:sync`

Expected: all sync tests PASS.

- [ ] **Step 3: Run dry configuration check with no secrets**

Run: `npm run sync:assistant`

Expected: exits non-zero with `缺少配置 EDGEONE_API_URL` and does not create files.

- [ ] **Step 4: Add a two-phase failure-safety test**

```js
import { mkdir, writeFile } from "node:fs/promises";
import { pull, publish } from "../scripts/assistant-sync/run.mjs";

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
  const pulled = await pull(env, { edgeFactory });
  assert.deepEqual(calls, []);
  await mkdir(join(root, "05-projects", "daily-conversations"), { recursive: true });
  await mkdir(join(root, "05-projects", "mobile-assistant"), { recursive: true });
  await writeFile(join(root, "05-projects", "daily-conversations", "2026-07-13.md"), "# 正式记录");
  await writeFile(join(root, "05-projects", "mobile-assistant", "手机助手记忆包.md"), "# 记忆包");
  const imaFactory = () => ({ importNote: async () => { throw new Error("IMA失败"); } });
  await assert.rejects(() => publish(pulled.batchPath, env, { edgeFactory, imaFactory }), /IMA失败/);
  assert.deepEqual(calls, ["memory"]);
});
```

- [ ] **Step 5: Commit**

```bash
git add scripts/assistant-sync/run.mjs .env.example package.json tests/assistant-sync.test.mjs
git commit -m "feat: add Codex EdgeOne and IMA sync command"
```

### Task 5: Configure local secrets, automation and WorkBuddy cutover

**Files:**
- Create: `docs/assistant-sync-operations.md`

- [ ] **Step 1: Write the operations runbook**

```markdown
# Assistant sync operations

## Local secrets

Store EdgeOne and IMA credentials outside the repository. Do not paste them into chat, commit them, or place them in the knowledge base.

## Manual verification

1. Upload one test text file from phone A.
2. Confirm phone B sees the same chat but not phone A's ledger.
3. Run `npm run sync:assistant` with local environment variables and note the returned batch path.
4. Confirm the file appears under `D:\缘的成长知识库\00-inbox\edgeone待整理`.
5. Confirm `sync-state.json` contains the EdgeOne item ID.
6. Let Codex read the batch files plus relevant goals, profile and recent records from the local knowledge base. Codex writes `05-projects\daily-conversations\YYYY-MM-DD.md` and updates `05-projects\mobile-assistant\手机助手记忆包.md`; fixed sample text is never used as the real summary.
7. Run `npm run sync:assistant:publish -- <batch-path>` only after checking both output files exist.
8. Run pull again and confirm the source is not duplicated.
9. Confirm the newest memory pack is visible to the webpage assistant.
10. Confirm the formal daily Markdown note appears in the selected IMA knowledge base.

## IMA upload boundary

The first version uploads only the final Markdown daily note to IMA. Images, PDFs, Word files and other attachments remain in the local knowledge base; the Markdown note may reference their local names but does not upload the binaries to IMA.

## WorkBuddy cutover

For seven days, WorkBuddy writes only to `D:\缘的成长知识库\00-inbox\workbuddy-verification`; Codex writes to the EdgeOne inbox. Compare daily counts and hashes. Stop WorkBuddy only after seven consecutive days with no missing, duplicate, or garbled files.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 3: Create or update the local 08:30 Codex automation**

Use the Codex automation tool, not a raw cron file. Configure a daily local automation against this project with prompt:

```text
Run the personal assistant sync workflow for the current Shanghai date. Read local secrets from the configured environment without printing them. First execute npm run sync:assistant and read the returned batch JSON. If the batch has items, read every listed local source plus only the relevant profile, goals, current plans and recent records in D:\缘的成长知识库. Write an evidence-based daily Markdown record to 05-projects\daily-conversations\YYYY-MM-DD.md with sections 今日概况、重要事实、决定与感悟、待跟进、来源编号. Update 05-projects\mobile-assistant\手机助手记忆包.md with only 沟通偏好、当前目标、近期状态、重要规则、待跟进; never copy the full raw transcript or ledger data. Then run npm run sync:assistant:publish -- <batch-path>. Verify the EdgeOne acknowledgements, memory version, local files and IMA note. If any stage fails, do not acknowledge or delete source data; report the exact failing stage. If the batch is empty, refresh the memory pack only when relevant local knowledge changed, and do not create an empty IMA daily note.
```

Expected schedule: every day at 08:30 Asia/Shanghai, before the existing 09:10 daily-plan automation.

- [ ] **Step 4: Commit**

```bash
git add docs/assistant-sync-operations.md
git commit -m "docs: add assistant sync operations and cutover"
```
