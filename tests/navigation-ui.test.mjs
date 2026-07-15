import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("formal page points assistant requests to the current CloudBase relay", () => {
  assert.match(html, /<html[^>]+data-assistant-api="https:\/\/yuan-assistant-test-d2bd198841e7\.service\.tcloudbase\.com"/);
});

test("navigation opens today and orders today, assistant, ledger, other", () => {
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual([...nav.matchAll(/<button[^>]*>(?:<span[^>]*>.*?<\/span>)?([^<]+)/g)].map((match) => match[1].trim()), ["今天", "助手", "账本", "其他"]);
  assert.match(html, /<section id="today-view" class="view"/);
  assert.doesNotMatch(html, /<section id="today-view"[^>]*hidden/);
});

test("top bar and temporary transfer are removed", () => {
  assert.doesNotMatch(html, /class="topbar"|assistant-transfer|临时中转资料/);
});

test("other view is a weather-first tool hub", () => {
  assert.match(html, /id="other-view"/);
  assert.match(html, /id="weather-panel"/);
  assert.match(html, /data-tool-view="assistant-backstage-view"/);
  assert.match(html, /data-tool-view="growth-review-view"/);
  assert.match(html, /href="https:\/\/synthapi\.asia\/wallet"[^>]+target="_blank"[^>]+rel="noreferrer"/);
  assert.match(html, /id="assistant-backstage-view"[^>]+hidden/);
  assert.match(html, /id="growth-review-view"[^>]+hidden/);
});
