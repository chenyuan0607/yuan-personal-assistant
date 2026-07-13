# 每日任务番茄钟与反馈闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每日任务增加按建议分钟数运行的番茄钟、完成确认和今日进度，并把任务反馈及隐私化账本摘要经 EdgeOne 中转站在每天 00:10 收取到本地知识库。

**Architecture:** 浏览器端使用独立的纯函数模块维护计时状态和反馈数据，使用本地存储保证刷新、关闭与断网后可恢复；UI 只通过事件调用该模块。EdgeOne 新增专用反馈接口，设备令牌负责写入，Codex 令牌负责批量读取和确认。电脑端使用独立同步脚本生成一份按日期覆盖更新的 Markdown 报告，确认本地写入后才确认云端记录。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Web Storage、Node.js test runner、EdgeOne Functions/KV、Node.js 文件同步脚本、Windows/Codex 定时自动任务。

---

## 文件结构

- Create `js/pomodoro.js`: 纯计时状态、任务结果和进度计算。
- Create `js/pomodoro-store.js`: 本地计时、反馈队列和恢复逻辑。
- Create `js/pomodoro-ui.js`: 计时视图、完成确认和任务状态渲染。
- Create `js/feedback-sync.js`: 浏览器端反馈上传与断网补传。
- Modify `js/tasks.js`: 为每日任务生成稳定编号并挂接番茄钟入口。
- Modify `js/ledger.js`: 生成严格白名单的每日账本摘要。
- Modify `js/ledger-ui.js`: 账目变化后重算摘要并通知同步层。
- Modify `js/assistant-store.js`: 保存设备名称并增加通用待上传反馈队列。
- Modify `js/assistant-api.js`: 增加反馈写入接口。
- Modify `js/app.js`: 初始化番茄钟与反馈同步，连接任务和账本事件。
- Modify `index.html`: 增加今日进度、计时视图和完成确认对话框。
- Modify `styles.css`: 增加手机端计时器、进度条和任务状态样式。
- Modify `service-worker.js`: 缓存新模块并升级缓存版本。
- Create `edge-functions/_lib/feedback.js`: 反馈键、白名单校验和规范化。
- Create `edge-functions/api/feedback.js`: 设备写入反馈的 EdgeOne 接口。
- Modify `edge-functions/api/codex.js`: Codex 批量读取和确认反馈。
- Modify `scripts/assistant-sync/edgeone-client.mjs`: 增加反馈读取和确认客户端方法。
- Create `scripts/feedback-sync/report.mjs`: 生成每日任务与账本摘要 Markdown。
- Create `scripts/feedback-sync/run.mjs`: 00:10 拉取、写入、确认及迟到数据覆盖。
- Modify `package.json`: 增加 `sync:feedback` 命令。
- Modify `.env.example`: 记录反馈同步复用的本地环境变量。
- Modify `docs/assistant-sync-operations.md`: 增加 00:10 反馈收取操作说明。
- Create `tests/pomodoro.test.mjs`: 计时与进度纯函数测试。
- Modify `tests/tasks.test.mjs`: 稳定任务编号测试。
- Modify `tests/ledger.test.mjs`: 账本摘要隐私白名单测试。
- Modify `tests/assistant-ui.test.mjs`: API 与待上传队列测试。
- Modify `tests/assistant-backend.test.mjs`: KV 反馈幂等写入、读取、确认和拒绝敏感字段测试。
- Create `tests/feedback-sync.test.mjs`: 每日报告与“写入成功后才确认”测试。

### Task 1: 稳定任务编号与计时领域模型

**Files:**
- Create: `js/pomodoro.js`
- Modify: `js/tasks.js`
- Create: `tests/pomodoro.test.mjs`
- Modify: `tests/tasks.test.mjs`

- [ ] **Step 1: Write the failing stable-id tests**

在 `tests/tasks.test.mjs` 增加：

```js
import { isPlanStale, taskId, validatePlan } from "../js/tasks.js";

test("task ids remain stable for the same dated task", () => {
  assert.equal(taskId("2026-07-14", "must", 0, "整理资料"), taskId("2026-07-14", "must", 0, "整理资料"));
  assert.notEqual(taskId("2026-07-14", "must", 0, "整理资料"), taskId("2026-07-14", "must", 1, "整理资料"));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/tasks.test.mjs`

Expected: FAIL because `taskId` is not exported.

- [ ] **Step 3: Implement the stable id**

在 `js/tasks.js` 增加确定性散列，不依赖随机值：

```js
export function taskId(date, group, index, title) {
  const source = `${date}|${group}|${index}|${title}`;
  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `task-${date}-${group}-${index}-${(hash >>> 0).toString(36)}`;
}
```

- [ ] **Step 4: Write failing pomodoro model tests**

创建 `tests/pomodoro.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { completeSession, createSession, pauseSession, progressSummary, remainingMs, resumeSession } from "../js/pomodoro.js";

test("timer uses the task suggested minutes and excludes pauses", () => {
  const started = createSession({ taskId: "t1", title: "整理资料", minutes: 20, now: 1_000 });
  assert.equal(remainingMs(started, 61_000), 1_140_000);
  const paused = pauseSession(started, 61_000);
  const resumed = resumeSession(paused, 181_000);
  assert.equal(remainingMs(resumed, 241_000), 1_080_000);
});

test("completion keeps attempts and progress counts only completed tasks", () => {
  const session = createSession({ taskId: "t1", title: "整理资料", minutes: 20, now: 0 });
  const result = completeSession(session, { outcome: "unfinished", now: 600_000, eventId: "e1", date: "2026-07-14", deviceName: "手机A" });
  assert.equal(result.focusedSeconds, 600);
  assert.deepEqual(progressSummary([result], ["t1", "t2"]), { completed: 0, total: 2, percent: 0, focusedMinutes: 10 });
});
```

- [ ] **Step 5: Run the model tests and verify RED**

Run: `node --test tests/pomodoro.test.mjs`

Expected: FAIL because `js/pomodoro.js` does not exist.

- [ ] **Step 6: Implement the minimal pure model**

创建 `js/pomodoro.js`，导出：

```js
export function createSession({ taskId, title, minutes, now = Date.now() }) {
  if (!taskId || !title || !Number.isInteger(minutes) || minutes <= 0) throw new Error("番茄钟任务无效");
  return { taskId, title, plannedSeconds: minutes * 60, focusedSeconds: 0, runningSince: now, status: "running" };
}

export function elapsedSeconds(session, now = Date.now()) {
  return session.focusedSeconds + (session.status === "running" ? Math.max(0, Math.floor((now - session.runningSince) / 1000)) : 0);
}

export function remainingMs(session, now = Date.now()) {
  return Math.max(0, (session.plannedSeconds - elapsedSeconds(session, now)) * 1000);
}

export function pauseSession(session, now = Date.now()) {
  if (session.status !== "running") return session;
  return { ...session, focusedSeconds: elapsedSeconds(session, now), runningSince: null, status: "paused" };
}

export function resumeSession(session, now = Date.now()) {
  if (session.status !== "paused") return session;
  return { ...session, runningSince: now, status: "running" };
}

export function completeSession(session, { outcome, now = Date.now(), eventId, date, deviceName }) {
  if (!['completed', 'unfinished'].includes(outcome)) throw new Error("完成结果无效");
  return { id: eventId, kind: "task-result", taskId: session.taskId, title: session.title, date, deviceName, plannedMinutes: session.plannedSeconds / 60, focusedSeconds: elapsedSeconds(session, now), outcome, completedAt: new Date(now).toISOString() };
}

export function progressSummary(results, taskIds) {
  const latest = new Map();
  for (const result of results) latest.set(result.taskId, result);
  const completed = taskIds.filter((id) => latest.get(id)?.outcome === "completed").length;
  const focusedSeconds = results.reduce((sum, item) => sum + item.focusedSeconds, 0);
  return { completed, total: taskIds.length, percent: taskIds.length ? Math.round(completed / taskIds.length * 100) : 0, focusedMinutes: Math.floor(focusedSeconds / 60) };
}
```

- [ ] **Step 7: Run both tests and verify GREEN**

Run: `node --test tests/tasks.test.mjs tests/pomodoro.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/tasks.js js/pomodoro.js tests/tasks.test.mjs tests/pomodoro.test.mjs
git commit -m "feat: add pomodoro task model"
```

### Task 2: 本地恢复、完成队列与进度数据

**Files:**
- Create: `js/pomodoro-store.js`
- Modify: `js/assistant-store.js`
- Modify: `tests/pomodoro.test.mjs`
- Modify: `tests/assistant-ui.test.mjs`

- [ ] **Step 1: Write failing store tests**

在 `tests/pomodoro.test.mjs` 增加一个内存 Storage 替身，验证活动计时器、结果和待上传记录在重新创建 store 后仍存在；在 `tests/assistant-ui.test.mjs` 验证设备名称随令牌保存。

```js
test("browser store restores the active timer and queued results", () => {
  const storage = memoryStorage();
  const first = createPomodoroStore(storage);
  first.saveSession({ taskId: "t1", status: "paused" });
  first.addResult({ id: "e1", taskId: "t1" });
  const second = createPomodoroStore(storage);
  assert.equal(second.session().taskId, "t1");
  assert.deepEqual(second.pending().map((item) => item.id), ["e1"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/pomodoro.test.mjs tests/assistant-ui.test.mjs`

Expected: FAIL because the new store API does not exist.

- [ ] **Step 3: Implement `createPomodoroStore`**

使用单一键 `yuan-pomodoro-v1` 保存 `{ session, results, pending }`。所有读取都容错解析；`addResult` 以 id 去重；`ack` 只删除 pending 标记，不删除本地结果；`clearSession` 只在用户确认完成结果后调用。

- [ ] **Step 4: Persist device name in assistant store**

把 `setToken(token)` 改为 `setSession({ token, deviceName })`，保留兼容的 `setToken`；增加 `deviceName()`。登录成功时保存用户输入的设备名称。

- [ ] **Step 5: Run and verify GREEN**

Run: `node --test tests/pomodoro.test.mjs tests/assistant-ui.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/pomodoro-store.js js/assistant-store.js js/assistant-ui.js tests/pomodoro.test.mjs tests/assistant-ui.test.mjs
git commit -m "feat: persist pomodoro feedback locally"
```

### Task 3: 今日进度、计时页面和完成确认 UI

**Files:**
- Create: `js/pomodoro-ui.js`
- Modify: `js/tasks.js`
- Modify: `js/app.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `service-worker.js`
- Modify: `tests/pomodoro.test.mjs`

- [ ] **Step 1: Write failing UI-independent rendering tests**

在 `js/pomodoro.js` 设计并测试 `formatClock(milliseconds)` 与 `taskStatus(results, taskId)`，避免把计时规则藏在 DOM 代码中。

```js
test("clock and latest task status are deterministic", () => {
  assert.equal(formatClock(1_500_000), "25:00");
  assert.equal(taskStatus([{ taskId: "t1", outcome: "unfinished" }, { taskId: "t1", outcome: "completed" }], "t1"), "completed");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/pomodoro.test.mjs`

Expected: FAIL because the helpers are missing.

- [ ] **Step 3: Implement helpers and verify GREEN**

Run: `node --test tests/pomodoro.test.mjs`

Expected: PASS.

- [ ] **Step 4: Add semantic HTML**

在 `today-view` 的焦点区后增加：

```html
<section class="today-progress" aria-labelledby="today-progress-title">
  <div class="progress-heading"><h3 id="today-progress-title">今日进度</h3><strong data-task-percent>0%</strong></div>
  <div class="task-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-task-progress></span></div>
  <p><span data-task-count>已完成 0 / 0 项</span> · <span data-focus-minutes>今日专注 0 分钟</span></p>
</section>
```

新增 `pomodoro-view`、返回按钮、大号时钟、开始/暂停/继续/提前结束按钮，以及 `pomodoro-result-dialog` 中的“已完成”“未完成”。

- [ ] **Step 5: Implement `initPomodoro`**

`js/pomodoro-ui.js` 接收 `{ root, store, onPending }`：

- 使用 `data-task-id` 绑定任务按钮。
- 打开计时视图时从任务 `minutes` 创建 session。
- 每秒用 `remainingMs` 计算显示，不依赖递减变量。
- 归零或提前结束时打开确认框。
- 确认后保存结果、清除活动 session、更新任务状态和进度、调用 `onPending()`。
- 页面初始化时恢复活动 session；若已到期，直接打开确认框。

- [ ] **Step 6: Connect task rendering**

`renderPlan` 为每项任务设置稳定 `data-task-id`，显示分钟数和番茄钟按钮，并把 `{ id, title, minutes }` 交给计时 UI。任务没有有效 `minutes` 时不显示按钮。

- [ ] **Step 7: Add responsive styles**

进度区使用现有绿色；已完成为绿色，未完成为橙色；计时视图大号数字在 320px 手机宽度下不溢出。按钮触控高度至少 44px。

- [ ] **Step 8: Update service worker cache**

缓存版本升级到 `yuan-assistant-v6`，把 `pomodoro.js`、`pomodoro-store.js`、`pomodoro-ui.js` 和后续 `feedback-sync.js` 加入 shell。

- [ ] **Step 9: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add index.html styles.css service-worker.js js/app.js js/tasks.js js/pomodoro.js js/pomodoro-ui.js tests/pomodoro.test.mjs
git commit -m "feat: add task pomodoro interface"
```

### Task 4: 隐私化账本摘要和浏览器上传队列

**Files:**
- Modify: `js/ledger.js`
- Modify: `js/ledger-ui.js`
- Create: `js/feedback-sync.js`
- Modify: `js/assistant-api.js`
- Modify: `js/app.js`
- Modify: `tests/ledger.test.mjs`
- Modify: `tests/assistant-ui.test.mjs`

- [ ] **Step 1: Write failing ledger summary tests**

在 `tests/ledger.test.mjs` 增加：

```js
test("daily ledger summary exposes aggregates but no record details", () => {
  const result = buildDailyLedgerSummary(records, { "budget:2026-07": 300000 }, "2026-07-13", "手机A");
  assert.deepEqual(result.categories, { 餐饮: 3580 });
  assert.equal(result.expenseCents, 3580);
  assert.equal(result.monthBudgetCents, 300000);
  assert.equal(JSON.stringify(result).includes("午餐"), false);
  assert.equal(JSON.stringify(result).includes('"records"'), false);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/ledger.test.mjs`

Expected: FAIL because `buildDailyLedgerSummary` is missing.

- [ ] **Step 3: Implement a strict whitelist summary**

`buildDailyLedgerSummary(records, settings, date, deviceName)` 返回：

```js
{
  id: `ledger-${date}-${safeDeviceId}`,
  kind: "ledger-summary",
  date,
  deviceName,
  incomeCents,
  expenseCents,
  balanceCents,
  incomeCount,
  expenseCount,
  categories,
  monthBudgetCents,
  monthExpenseCents,
  monthRemainingCents,
  budgetState,
  updatedAt
}
```

函数不能复制、展开或返回原始 record。

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/ledger.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing feedback queue/API tests**

验证 `createAssistantApi().saveFeedback(record)` 调用 `POST /api/feedback`，以及 `flushFeedback` 仅在成功后 ack 本地 pending。

- [ ] **Step 6: Implement browser sync**

`js/feedback-sync.js` 导出：

```js
export async function flushFeedback(store, api) {
  if (!api.hasToken()) return { sent: 0 };
  let sent = 0;
  for (const record of store.pending()) {
    await api.saveFeedback(record);
    store.ack(record.id);
    sent += 1;
  }
  return { sent };
}
```

实际 `api` 使用闭包 token，不把 token 放进反馈记录。失败时停止并保留剩余队列。

- [ ] **Step 7: Connect ledger mutations**

`initLedger({ onSummary })` 在初始加载、保存、删除、导入恢复和预算修改后调用 `onSummary(buildDailyLedgerSummary(...))`。摘要按 `设备＋日期` 使用固定 id，因此本地 pending 队列和云端都覆盖旧摘要。

- [ ] **Step 8: Run targeted and full tests**

Run: `node --test tests/ledger.test.mjs tests/assistant-ui.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add js/ledger.js js/ledger-ui.js js/feedback-sync.js js/assistant-api.js js/app.js tests/ledger.test.mjs tests/assistant-ui.test.mjs
git commit -m "feat: queue private task and ledger summaries"
```

### Task 5: EdgeOne 反馈接口与 Codex 收取接口

**Files:**
- Create: `edge-functions/_lib/feedback.js`
- Create: `edge-functions/api/feedback.js`
- Modify: `edge-functions/api/codex.js`
- Modify: `edge-functions/api/cleanup.js`
- Modify: `tests/assistant-backend.test.mjs`

- [ ] **Step 1: Write failing validation and idempotency tests**

在 `tests/assistant-backend.test.mjs` 增加具体断言：

- `task-result` 只接受允许字段和 `completed|unfinished`。
- `ledger-summary` 拒绝 `note`、`records`、`backup` 等敏感字段。
- 同 id 的任务结果重复提交只覆盖同一 KV 键。
- 同设备同日期账本摘要覆盖旧值。
- Codex 只能读 `status === "waiting"` 的反馈。
- 本地报告确认后 `feedback-ack` 把记录改为 processed。

```js
assert.throws(() => validateFeedback({ kind: "ledger-summary", records: [{}] }), /敏感|字段/);
assert.equal(feedbackKey("owner", "ledger-summary", "2026-07-14", "ledger-1"), "feedback_owner_ledger_summary_2026_07_14_ledger_1");

test("ledger feedback rejects detail fields and overwrites the daily device summary", async () => {
  assert.throws(() => validateFeedback({ kind: "ledger-summary", id: "l1", date: "2026-07-14", deviceName: "手机A", records: [] }), /字段/);
  const first = validateFeedback({ kind: "ledger-summary", id: "ledger-2026-07-14-phone-a", date: "2026-07-14", deviceName: "手机A", incomeCents: 0, expenseCents: 1000, balanceCents: -1000, incomeCount: 0, expenseCount: 1, categories: { 餐饮: 1000 }, monthBudgetCents: 300000, monthExpenseCents: 1000, monthRemainingCents: 299000, budgetState: "normal", updatedAt: "2026-07-14T12:00:00Z" });
  const second = validateFeedback({ ...first, expenseCents: 1500, balanceCents: -1500, categories: { 餐饮: 1500 }, monthExpenseCents: 1500, monthRemainingCents: 298500, updatedAt: "2026-07-14T13:00:00Z" });
  assert.equal(feedbackKey("owner", first.kind, first.date, first.id), feedbackKey("owner", second.kind, second.date, second.id));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/assistant-backend.test.mjs`

Expected: FAIL because feedback modules and actions do not exist.

- [ ] **Step 3: Implement strict feedback normalization**

`edge-functions/_lib/feedback.js` 使用字段白名单重建对象，绝不使用 `{ ...body }`。限制标题、设备名和分类数量/长度；金额必须是安全整数；日期必须是 `YYYY-MM-DD`。

- [ ] **Step 4: Implement device POST endpoint**

`edge-functions/api/feedback.js`：

- 要求 `device` token。
- 只接受 POST。
- 规范化后写入 `feedbackKey(owner.sub, kind, date, id)`。
- 保存 `status: "waiting"`、`createdAt` 和 `updatedAt`。
- 账本摘要同 key 覆盖；任务结果同事件 id 幂等。

- [ ] **Step 5: Extend Codex actions**

`/api/codex?action=feedback-pull&date=YYYY-MM-DD` 返回 waiting 反馈；`feedback-ack` 接受 ids 和 localPath，在全部记录存在后逐一改为 processed。现有文件、聊天和记忆逻辑不改变。

- [ ] **Step 6: Include feedback in cleanup**

processed 反馈保留 7 天；未处理反馈超过 30 天只报告状态，不静默删除。

- [ ] **Step 7: Run backend and full tests**

Run: `node --test tests/assistant-backend.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add edge-functions/_lib/feedback.js edge-functions/api/feedback.js edge-functions/api/codex.js edge-functions/api/cleanup.js tests/assistant-backend.test.mjs
git commit -m "feat: add secure feedback relay api"
```

### Task 6: 00:10 本地报告生成与可靠确认

**Files:**
- Modify: `scripts/assistant-sync/edgeone-client.mjs`
- Create: `scripts/feedback-sync/report.mjs`
- Create: `scripts/feedback-sync/run.mjs`
- Create: `tests/feedback-sync.test.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `docs/assistant-sync-operations.md`

- [ ] **Step 1: Write failing report tests**

创建 `tests/feedback-sync.test.mjs`：

```js
test("report groups tasks and ledger summaries by device without details", () => {
  const markdown = buildFeedbackReport({ date: "2026-07-14", items });
  assert.match(markdown, /已完成 1 \/ 2 项/);
  assert.match(markdown, /手机A/);
  assert.doesNotMatch(markdown, /午餐备注/);
});

test("sync acknowledges only after the report is written", async () => {
  const calls = [];
  await syncFeedback(env, { edgeFactory, writeFileImpl: async () => calls.push("write") });
  assert.deepEqual(calls, ["write", "ack"]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/feedback-sync.test.mjs`

Expected: FAIL because feedback sync modules do not exist.

- [ ] **Step 3: Implement report builder**

报告路径固定为：

```text
D:\缘的成长知识库\00-inbox\每日反馈\YYYY-MM-DD-任务与账本反馈.md
```

Markdown 包含任务总数、最终完成数、完成率、总专注时间、逐任务尝试次数与最终状态，以及按设备分开的账本摘要。迟到数据再次运行时覆盖同一日期文件，并更新“最后同步时间”。

- [ ] **Step 4: Extend EdgeOne client**

增加：

```js
pullFeedback: (date) => request(`/api/codex?action=feedback-pull&date=${encodeURIComponent(date)}`),
ackFeedback: (ids, localPath) => request("/api/codex?action=feedback-ack", { method: "POST", body: JSON.stringify({ ids, localPath }) }),
```

- [ ] **Step 5: Implement reliable sync**

`syncFeedback` 默认收取北京时间前一日。顺序必须是：拉取 → 生成 → 创建目录 → 原子写临时文件 → 重命名为正式文件 → ack。任一步失败都不 ack。

- [ ] **Step 6: Add package command and docs**

`package.json` 增加：

```json
"sync:feedback": "node scripts/feedback-sync/run.mjs"
```

文档说明复用 `EDGEONE_API_URL`、`EDGEONE_CODEX_TOKEN`、`YUAN_KB_ROOT`，不需要 IMA 密钥。

- [ ] **Step 7: Run targeted and full tests**

Run: `node --test tests/feedback-sync.test.mjs tests/assistant-sync.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/assistant-sync/edgeone-client.mjs scripts/feedback-sync tests/feedback-sync.test.mjs package.json .env.example docs/assistant-sync-operations.md
git commit -m "feat: collect daily feedback reports"
```

### Task 7: 配置自动收取、部署与端到端验证

**Files:**
- Deployment: GitHub `main` and EdgeOne project `makers-dqq6tvzezgva`
- Local automation: daily 00:10 Asia/Shanghai

- [ ] **Step 1: Run fresh verification**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: all tests pass, no whitespace errors, only intended changes before final commit.

- [ ] **Step 2: Test the UI locally**

在本地网页验证：

- 建议 15 分钟任务打开 15:00。
- 暂停后时间不减少。
- 刷新后恢复。
- “未完成”增加专注时间但不增加进度。
- 再次计时并选择“已完成”后进度增加。
- 账本保存后只产生摘要 pending，不含备注或原始 records。

- [ ] **Step 3: Configure local sync environment securely**

从 `.assistant-secrets/edgeone.json` 读取 Codex token，写入只在本机使用的环境配置；不得把 token 输出到聊天、Git、知识库或测试日志。

- [ ] **Step 4: Create the 00:10 automation**

创建每日自动任务，时区 `Asia/Shanghai`，运行 `npm run sync:feedback`，工作目录为项目目录。失败时保留云端记录供下一次重试。

- [ ] **Step 5: Push main and verify EdgeOne deployment**

Run: `git push origin main`

在 EdgeOne 控制台确认最新 commit 部署状态为 Success，并确认 edge functions 编译成功。

- [ ] **Step 6: Handle the KV gate honestly**

如果 KV 仍为 Pending Approval：

- 发布浏览器本地番茄钟、进度条和本地摘要队列。
- 不声称两台手机或云端反馈已经可用。
- 保留反馈队列，KV 绑定完成后再执行线上写入、Codex pull、ack 和两台手机测试。

如果 KV 已通过：

- 创建并绑定 `YUAN_ASSISTANT_KV`。
- 使用访问码登录测试设备。
- 上传一条测试任务结果和一份不含明细的账本摘要。
- 运行 `npm run sync:feedback`。
- 确认本地知识库报告生成且云端记录已 ack。

- [ ] **Step 7: Final evidence**

再次运行 `npm test`，检查 `git status --short`，记录部署 ID、测试总数和 KV 实际状态后再向用户报告。
