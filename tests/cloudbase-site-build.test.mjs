import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildCloudBaseSite } from "../scripts/build-cloudbase-site.mjs";

test("CloudBase test site injects its API and copies only public assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "yuan-cloudbase-site-"));
  const sourceDir = join(root, "source");
  const outputDir = join(root, "dist");
  await mkdir(join(sourceDir, "js"), { recursive: true });
  await mkdir(join(sourceDir, "data"), { recursive: true });
  await mkdir(join(sourceDir, "icons"), { recursive: true });
  await mkdir(join(sourceDir, "assets", "stickers"), { recursive: true });
  await mkdir(join(sourceDir, ".assistant-secrets"), { recursive: true });
  await writeFile(join(sourceDir, "index.html"), '<!doctype html><html lang="zh-CN"><body></body></html>');
  await writeFile(join(sourceDir, "reset.html"), '<!doctype html><html lang="zh-CN"><body>reset</body></html>');
  await writeFile(join(sourceDir, "styles.css"), "body { color: black; }");
  await writeFile(join(sourceDir, "service-worker.js"), "const CACHE = 'test';");
  await writeFile(join(sourceDir, "manifest.webmanifest"), "{}");
  await writeFile(join(sourceDir, "js", "app.js"), "export {};");
  await writeFile(join(sourceDir, "data", "today.json"), "{}");
  await writeFile(join(sourceDir, "icons", "icon-192.png"), "fixture");
  await writeFile(join(sourceDir, "assets", "stickers", "manifest.json"), '{"version":1,"stickers":[]}');
  await writeFile(join(sourceDir, ".assistant-secrets", "key.txt"), "must-not-copy");
  await writeFile(join(sourceDir, "package.json"), '{"private":true}');

  const apiUrl = "https://relay.example.com";
  const result = await buildCloudBaseSite({ sourceDir, outputDir, apiUrl });
  const html = await readFile(join(outputDir, "index.html"), "utf8");

  assert.equal(result.apiUrl, apiUrl);
  assert.match(html, /<html lang="zh-CN" data-assistant-api="https:\/\/relay\.example\.com">/);
  assert.equal((html.match(/data-assistant-api=/g) ?? []).length, 1);
  assert.match(await readFile(join(outputDir, "reset.html"), "utf8"), /reset/);
  assert.equal(await readFile(join(outputDir, "js", "app.js"), "utf8"), "export {};");
  assert.match(await readFile(join(outputDir, "assets", "stickers", "manifest.json"), "utf8"), /"stickers"/);
  await assert.rejects(readFile(join(outputDir, ".assistant-secrets", "key.txt"), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(join(outputDir, "package.json"), "utf8"), { code: "ENOENT" });
});

test("CloudBase test site rejects a non-HTTPS API", async () => {
  const root = await mkdtemp(join(tmpdir(), "yuan-cloudbase-site-"));
  await assert.rejects(
    buildCloudBaseSite({ sourceDir: root, outputDir: join(root, "dist"), apiUrl: "http://relay.example.com" }),
    /HTTPS/,
  );
});

test("CloudBase relay allows the exact test site origin", async () => {
  const config = JSON.parse(await readFile(new URL("../cloudbaserc.json", import.meta.url), "utf8"));
  const relay = config.functions.find((item) => item.name === "yuan-relay");
  const origins = relay.envVariables.ALLOWED_ORIGINS.split(",");
  assert.ok(origins.includes("https://yuan-assistant-test-d2bd198841e7-1453821016.tcloudbaseapp.com"));
  assert.ok(origins.includes("https://chenyuan0607.github.io"));
  assert.ok(!origins.includes("*"));
});
