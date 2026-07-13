# Ledger Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private monthly budget, category bars, search, custom categories, quick templates and version-2 backups without losing existing records.

**Architecture:** Keep ledger domain calculations in `js/ledger.js`, add settings and presentation helpers in focused modules, and upgrade IndexedDB without replacing the existing records store. All new state remains device-local.

**Tech Stack:** Vanilla JavaScript modules, IndexedDB, HTML/CSS, Node test runner.

---

### Task 1: Budget and category domain

**Files:** Modify `js/ledger.js`; modify `tests/ledger.test.mjs`.

- [ ] Add failing tests for `budgetStatus(spentCents, budgetCents)`, category ranking, and record search.
- [ ] Run `npm test`; expect failures for missing exports.
- [ ] Implement integer-cent calculations with thresholds `normal < 0.8`, `warning >= 0.8 && <= 1`, and `over > 1`; sort category totals descending; search category and note case-insensitively.
- [ ] Run `npm test`; expect all tests to pass.

### Task 2: Backup version 2 compatibility

**Files:** Modify `js/ledger.js`; modify `tests/ledger.test.mjs`.

- [ ] Add failing tests proving v1 imports return default settings and v2 round-trips records, budgets, custom categories and templates.
- [ ] Implement `{version:2, exportedAt, records, settings, categories, templates}` while accepting legacy v1 input.
- [ ] Run `npm test`; expect all tests to pass.

### Task 3: IndexedDB upgrade and ledger UI

**Files:** Modify `js/ledger-ui.js`; modify `index.html`; modify `styles.css`.

- [ ] Upgrade the database to version 2 and add `settings`, `categories`, and `templates` stores without deleting `records`.
- [ ] Add total-budget editing, progress display, threshold messages, search, category bars, category management and quick-template controls.
- [ ] Ensure disabled categories remain readable on old records but are absent from the new-record selector.
- [ ] Include all local state in export/import and require confirmation before replacement.
- [ ] Run `npm test` and verify add/edit/delete/import/export manually at 390px width.

### Task 4: Offline and documentation update

**Files:** Modify `service-worker.js`; modify `README.md`.

- [ ] Increment the cache name so upgraded assets replace the current offline shell.
- [ ] Document budget privacy, backup-v2 contents and v1 compatibility.
- [ ] Run `npm test`, `npm run validate:today`, and JavaScript syntax checks.
- [ ] Commit with `feat: upgrade private ledger`.
