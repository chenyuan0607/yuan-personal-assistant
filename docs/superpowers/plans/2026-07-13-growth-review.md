# Growth Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local seven-day task history, a weekly-summary-first review page, and reliable knowledge-base backups for daily and weekly plans.

**Architecture:** Store task history in the browser only, fetch one privacy-filtered current weekly summary from the website, and extend the scheduled automation to write Obsidian-compatible backup files before publishing. Separate history, weekly-summary and rendering logic from current task rendering.

**Tech Stack:** Vanilla JavaScript modules, IndexedDB, JSON, Markdown, GitHub Pages, Codex local automation.

---

### Task 1: Local task-history domain

**Files:** Create `js/history.js`; create `tests/history.test.mjs`.

- [ ] Add failing tests for same-date replacement, newest-first ordering and pruning entries older than seven Beijing calendar days.
- [ ] Run `npm test`; expect failure because `js/history.js` is absent.
- [ ] Implement pure functions `mergePlanHistory(history, plan, today)` and `prunePlanHistory(history, today)` without network calls.
- [ ] Run `npm test`; expect all tests to pass.

### Task 2: Weekly summary validation

**Files:** Create `js/weekly.js`; create `tests/weekly.test.mjs`; create `data/weekly.json`; modify `scripts/validate-today.mjs`.

- [ ] Add failing tests for week-start date, summary, direction, evidence note and 1–3 adjustments.
- [ ] Implement `validateWeeklySummary` and sensitive-content validation for both published JSON files.
- [ ] Add a privacy-safe initial weekly summary and run all tests and publishing validation.

### Task 3: Review page and local persistence

**Files:** Modify `index.html`; modify `styles.css`; modify `js/app.js`; modify `js/tasks.js`; create `js/review-ui.js`.

- [ ] Add the third navigation item and a review view with weekly summary first and local seven-day history second.
- [ ] Save each successfully loaded current plan into a local IndexedDB history store; do not issue any request containing history data.
- [ ] Fetch and render `data/weekly.json`; retain a cached valid summary when offline or when a new summary is invalid.
- [ ] Verify at 390px and desktop widths, including empty-history and failed-summary states.

### Task 4: Knowledge-base backup templates and automation

**Files:** Create `scripts/daily-plan-backup-template.md`; create `scripts/weekly-review-backup-template.md`; modify `README.md`; update Codex automation `automation-2`.

- [ ] Define Obsidian-compatible YAML, tags and links for daily and weekly files.
- [ ] Update the automation to write idempotent files in `05-projects/daily-plans/` and `05-projects/weekly-reviews/`, publish JSON only after validation, and record final publishing status.
- [ ] Add one directory entry for each collection to the knowledge-base index without adding daily lines.
- [ ] Run a dry validation that writes no files, then manually create today's daily backup from the already-published plan and verify its format.

### Task 5: Offline, end-to-end verification and publishing

**Files:** Modify `service-worker.js`; modify `README.md`.

- [ ] Cache review assets and the latest valid weekly summary without caching local history outside IndexedDB.
- [ ] Run `npm test`, `npm run validate:today`, syntax checks, and privacy scans.
- [ ] Verify existing ledger records survive the upgrade and local history never appears in Git status or requests.
- [ ] Commit with `feat: add private growth review`, push, wait for GitHub Pages, and verify live daily and weekly JSON.
