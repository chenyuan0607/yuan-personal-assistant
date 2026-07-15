import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assistantAvatarSource, createAssistantPreferences, createSpeechController, emptyStickerMessage } from "../js/assistant-tools.js";

test("assistant avatar preference stays in browser storage", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const preferences = createAssistantPreferences(storage);
  assert.equal(preferences.avatar(), null);
  preferences.setAvatar("data:image/webp;base64,AAAA");
  assert.equal(preferences.avatar(), "data:image/webp;base64,AAAA");
  assert.throws(() => preferences.setAvatar("data:text/plain;base64,AAAA"), /图片/);
});

test("assistant avatar uses the app icon until a local picture is selected", () => {
  assert.equal(assistantAvatarSource({ avatar: () => null }), "./icons/icon-192.png");
  assert.equal(assistantAvatarSource({ avatar: () => "data:image/webp;base64,AAAA" }), "data:image/webp;base64,AAAA");
});

test("speech controller starts, stops and appends Chinese transcript", () => {
  const calls = [];
  class Recognition {
    start() { calls.push("start"); }
    stop() { calls.push("stop"); }
  }
  let transcript = "你好";
  const controller = createSpeechController({ Recognition, getValue: () => transcript, setValue: (value) => { transcript = value; } });
  controller.start();
  controller.recognition.onresult({ results: [[{ transcript: "世界" }]] });
  controller.stop();
  assert.deepEqual(calls, ["start", "stop"]);
  assert.equal(transcript, "你好 世界");
  assert.equal(controller.supported, true);
});

test("speech controller reports unsupported browsers", () => {
  assert.equal(createSpeechController({ Recognition: null, getValue: () => "", setValue: () => {} }).supported, false);
});

test("sticker library starts empty", async () => {
  const manifest = JSON.parse(await readFile(new URL("../assets/stickers/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest, { version: 1, stickers: [] });
  assert.equal(emptyStickerMessage(manifest), "还没有表情包素材");
});
