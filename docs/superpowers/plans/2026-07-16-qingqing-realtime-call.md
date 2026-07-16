# Qingqing Realtime Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, full-screen Qingqing voice-call page whose confirmed text becomes part of the existing daily chat archive.

**Architecture:** The browser owns microphone capture, call-page state, subtitles and audio playback. The existing authenticated assistant API issues only a short-lived realtime session and persists finalized text to the normal date-scoped chat store; the Alibaba long-lived key remains an EdgeOne environment variable.

**Tech Stack:** ES modules, browser Web Audio/WebSocket APIs, EdgeOne Pages Functions, Node test runner.

---

### Task 1: Transcript protocol

**Files:**
- Create: `js/realtime-call.js`
- Create: `tests/realtime-call.test.mjs`
- Modify: `js/assistant-api.js`
- Modify: `edge-functions/api/realtime.js`

- [ ] Write failing tests for normalized, deduplicated user/assistant transcript events and authenticated API methods.
- [ ] Implement the pure transcript buffer and API client methods.
- [ ] Implement the authenticated session and transcript endpoints, keeping `REALTIME_API_KEY` server-only.
- [ ] Run `node --test tests/realtime-call.test.mjs`.

### Task 2: Call page

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `js/app.js`
- Modify: `service-worker.js`
- Modify: `tests/assistant-ui.test.mjs`

- [ ] Write a failing shell test for the phone entry, full-screen call page, caption toggle, pen mode and hang-up button.
- [ ] Add the call page and mobile styles, including visible error and reconnect states.
- [ ] Bind the call page to the existing authenticated assistant session.
- [ ] Run the UI test file and update the service-worker cache list.

### Task 3: Realtime transport

**Files:**
- Modify: `js/realtime-call.js`
- Modify: `edge-functions/api/realtime.js`
- Modify: `.env.example`
- Modify: `docs/edgeone-setup.md`

- [ ] Write a failing test for provider event translation and server-only credential configuration.
- [ ] Add resilient WebSocket event handling, interruption, caption updates and persistence retries.
- [ ] Document the Alibaba environment variables and local secret handoff without exposing a key.
- [ ] Run the full test suite and CloudBase production build.
