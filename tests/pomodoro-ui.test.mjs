import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("focus mode hides the bottom navigation when the hidden attribute is set", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.bottom-nav\[hidden\]\{display:none\}/);
});

test("service worker cache version changes with the pomodoro shell", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /yuan-assistant-v8/);
});

test("result confirmation cannot be dismissed without choosing an outcome", async () => {
  const source = await readFile(new URL("../js/pomodoro-ui.js", import.meta.url), "utf8");
  assert.match(source, /resultDialog\.addEventListener\("cancel", \(event\) => event\.preventDefault\(\)\)/);
});
