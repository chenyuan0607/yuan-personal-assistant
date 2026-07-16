import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const appScript = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));

test("formal page points assistant requests to the current CloudBase relay", () => {
  assert.match(html, /<html[^>]+data-assistant-api="https:\/\/yuan-assistant-test-d2bd198841e7\.service\.tcloudbase\.com"/);
});

test("navigation opens assistant by default and orders today, assistant, ledger, other", () => {
  const nav = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
  assert.deepEqual([...nav.matchAll(/<button[^>]*>(?:<span[^>]*>.*?<\/span>)?([^<]+)/g)].map((match) => match[1].trim()), ["今天", "助手", "账本", "其他"]);
  assert.match(html, /<section id="today-view"[^>]*hidden/);
  assert.match(html, /<section id="assistant-view" class="view assistant-view"/);
  assert.doesNotMatch(html, /<section id="assistant-view"[^>]*hidden/);
  assert.match(nav, /id="assistant-tab" class="active"/);
  assert.doesNotMatch(nav, /id="today-tab" class="active"/);
  assert.match(appScript, /querySelector\("#assistant-view"\)\?\.hidden/);
  assert.match(appScript, /await assistantRefresh\(\)/);
});

test("top bar and temporary transfer are removed", () => {
  assert.doesNotMatch(html, /class="topbar"|assistant-transfer|临时中转资料/);
});

test("other view is a weather-first tool hub", () => {
  assert.match(html, /id="other-view"/);
  assert.match(html, /id="weather-panel"/);
  assert.match(html, /data-tool-view="assistant-backstage-view"/);
  assert.match(html, /data-tool-view="growth-review-view"/);
  assert.match(html, /data-tool-view="work-notifications-view"/);
  assert.match(html, /id="work-notifications-summary"/);
  assert.match(html, /href="https:\/\/synthapi\.asia\/wallet"[^>]+target="_blank"[^>]+rel="noreferrer"/);
  assert.match(html, /id="assistant-backstage-view"[^>]+hidden/);
  assert.match(html, /id="growth-review-view"[^>]+hidden/);
  assert.match(html, /id="work-notifications-view"[^>]+hidden/);
  assert.match(html, /id="work-notifications-back"/);
  assert.match(html, /id="work-notifications-list"/);
});

test("layout resists accidental zoom and stays phone-width on desktop", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  assert.match(styles, /html\{[^}]*-webkit-text-size-adjust:100%/);
  assert.match(styles, /body\{[^}]*overflow-x:hidden/);
  assert.match(styles, /input,select,button,textarea\{[^}]*font-size:16px/);
  assert.match(styles, /@media\(min-width:760px\)\{[^}]*\.bottom-nav\{[^}]*width:760px/);
});

test("manifest is installable as Qingqing app shell", () => {
  assert.equal(manifest.name, "缘的小助手");
  assert.equal(manifest.short_name, "青青");
  assert.equal(manifest.description, "缘的私人 AI 助手、任务和生活记录工具");
  assert.equal(manifest.start_url, "./#assistant");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.equal(manifest.background_color, "#ededed");
  assert.equal(manifest.theme_color, "#f2f2f2");
  assert.deepEqual(manifest.categories, ["productivity", "lifestyle"]);
  assert.ok(manifest.icons.every((icon) => icon.purpose === "any maskable"));
  assert.equal(manifest.screenshots[0].form_factor, "narrow");
});

test("emergency reset page clears stuck PWA state", async () => {
  const reset = await readFile(new URL("../reset.html", import.meta.url), "utf8");

  assert.match(reset, /退出卡住的通话页/);
  assert.match(reset, /navigator\.serviceWorker\.getRegistrations/);
  assert.match(reset, /registration\.unregister\(\)/);
  assert.match(reset, /caches\.keys\(\)/);
  assert.match(reset, /caches\.delete\(key\)/);
  assert.match(reset, /location\.replace\("\.\/#assistant"\)/);
});
