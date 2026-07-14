# Assistant Chat Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the editable AI avatar from the page heading into every assistant message row while keeping user messages as right-aligned bubbles without avatars.

**Architecture:** Keep one hidden avatar file input and the existing browser-only preference store. Message rendering creates a row for each message; assistant rows receive a reusable avatar button whose image source comes from the saved preference or the existing app icon.

**Tech Stack:** HTML, CSS, browser JavaScript, Node.js built-in test runner.

---

### Task 1: Define the chat-row contract

**Files:**
- Modify: `tests/assistant-ui.test.mjs`
- Modify: `tests/assistant-tools.test.mjs`

- [ ] Add assertions that the heading has no avatar, the hidden picker remains available, assistant rows contain an avatar control, and user rows do not.
- [ ] Run `node --test tests/assistant-ui.test.mjs tests/assistant-tools.test.mjs` and confirm the new assertions fail because the current avatar is still in the heading.

### Task 2: Render message avatars

**Files:**
- Modify: `index.html`
- Modify: `js/assistant-ui.js`
- Modify: `js/assistant-tools.js`
- Modify: `styles.css`

- [ ] Leave only the title and lock action in the heading, with one hidden image picker outside the message list.
- [ ] Expose the current avatar URL and avatar-picker action from `initAssistantTools`, defaulting to `./icons/icon-192.png`.
- [ ] Render each message inside a stable row. Add the editable avatar only to assistant rows and keep user rows avatar-free.
- [ ] Style assistant rows left, user rows right, with compact WeChat-like bubbles and fixed avatar dimensions.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Verify and publish

**Files:**
- Verify: all project files

- [ ] Run `npm test` and both CloudBase build commands.
- [ ] Check the formal page at a 390px mobile viewport for avatar visibility, message alignment, overflow, and input overlap.
- [ ] Commit only the intended files and push `main` so GitHub Pages publishes the change.
