import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("focus mode hides the bottom navigation when the hidden attribute is set", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.bottom-nav\[hidden\]\{display:none\}/);
});

test("service worker cache version includes the latest assistant shell", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /yuan-assistant-v38/);
  assert.match(worker, /\.\/js\/work-notifications\.js/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /fetch\(event\.request\).*caches\.match/s);
});

test("result confirmation cannot be dismissed without choosing an outcome", async () => {
  const source = await readFile(new URL("../js/pomodoro-ui.js", import.meta.url), "utf8");
  assert.match(source, /resultDialog\.addEventListener\("cancel", \(event\) => event\.preventDefault\(\)\)/);
});
