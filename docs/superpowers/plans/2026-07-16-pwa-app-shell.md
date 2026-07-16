# PWA App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing web assistant behave more like an installable lightweight app without rewriting it in uni-app.

**Architecture:** Keep the current plain web frontend and CloudBase backend. Improve the PWA metadata, add a small browser-side app shell helper for install/update prompts, and expose the helper from the existing “其他” hub as a lightweight card.

**Tech Stack:** HTML, CSS, vanilla JavaScript modules, Web App Manifest, Service Worker, Node test runner.

---

### Task 1: PWA Manifest Quality

**Files:**
- Modify: `manifest.webmanifest`
- Modify: `tests/navigation-ui.test.mjs`

- [ ] **Step 1: Write the failing test**

Add assertions that the manifest has readable Chinese names, a stable assistant start URL, standalone display, portrait orientation, categories, screenshots, and maskable icons.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/navigation-ui.test.mjs`

Expected: FAIL because the current manifest name is mojibake and lacks the extra install metadata.

- [ ] **Step 3: Write minimal manifest update**

Update `manifest.webmanifest` to use:

```json
{
  "name": "缘的小助手",
  "short_name": "青青",
  "description": "缘的私人 AI 助手、任务和生活记录工具",
  "start_url": "./#assistant",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ededed",
  "theme_color": "#f2f2f2",
  "categories": ["productivity", "lifestyle"],
  "icons": [
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "screenshots": [
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "form_factor": "narrow", "label": "青青助手" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/navigation-ui.test.mjs`

Expected: PASS.

### Task 2: Install And Update Helper

**Files:**
- Create: `js/pwa-app.js`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `styles.css`
- Modify: `service-worker.js`
- Modify: `tests/assistant-ui.test.mjs`
- Modify: `tests/pomodoro-ui.test.mjs`

- [ ] **Step 1: Write the failing test**

Add assertions that:

```js
assert.match(html, /id="pwa-install-card"/);
assert.match(app, /initPwaApp/);
assert.match(pwa, /beforeinstallprompt/);
assert.match(pwa, /registration\.waiting\.postMessage\(\{ type: "SKIP_WAITING" \}\)/);
assert.match(worker, /yuan-assistant-v45-pwa-app-shell/);
assert.match(worker, /message/);
assert.match(worker, /skipWaiting/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/assistant-ui.test.mjs tests/pomodoro-ui.test.mjs`

Expected: FAIL because there is no PWA helper yet and cache version is still v44.

- [ ] **Step 3: Add minimal helper and UI**

Create `js/pwa-app.js` that listens for `beforeinstallprompt`, updates a card in the “其他” page, calls `prompt()` when the user taps install, and shows an “更新网页” button when a waiting service worker exists.

Add a small `#pwa-install-card` button to the “其他” tool grid.

- [ ] **Step 4: Add service worker update message**

Update `service-worker.js` cache name to `yuan-assistant-v45-pwa-app-shell` and add:

```js
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

- [ ] **Step 5: Run targeted tests**

Run: `node --test tests/assistant-ui.test.mjs tests/pomodoro-ui.test.mjs`

Expected: PASS.

### Task 3: Verify And Ship

**Files:**
- Modify only files changed by Tasks 1 and 2.

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: 0 failures.

- [ ] **Step 2: Build static site and CloudBase bundle**

Run:

```powershell
npm run build:cloudbase-site
npm run build:cloudbase
```

Expected: both commands exit 0.

- [ ] **Step 3: Deploy CloudBase static site**

Run:

```powershell
npx --yes -p @cloudbase/cli cloudbase hosting deploy cloudbase-site-dist / --env-id yuan-assistant-test-d2bd198841e7 --json
```

Expected: upload succeeds.

- [ ] **Step 4: Commit and publish GitHub Pages**

Commit the changed files and publish the same files to GitHub main using the existing API fallback if normal git push is rejected.

- [ ] **Step 5: Verify online assets**

Check both CloudBase and GitHub Pages for `yuan-assistant-v45-pwa-app-shell`, `pwa-install-card`, and `beforeinstallprompt`.
