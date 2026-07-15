import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatBody,
  buildSynthApiEndpoints,
  classifyVisionResult,
  maskSecret,
  rankModelIds,
  resolveTimeoutMs,
} from "../scripts/synthapi-probe.mjs";

test("SynthAPI endpoints are built from the root URL", () => {
  assert.deepEqual(buildSynthApiEndpoints("https://synthapi.asia/"), {
    baseUrl: "https://synthapi.asia",
    modelsUrl: "https://synthapi.asia/v1/models",
    chatUrl: "https://synthapi.asia/v1/chat/completions",
  });
});

test("secret masking never exposes the original key", () => {
  const secret = "sk-test-1234567890abcdef";
  const masked = maskSecret(secret);

  assert.equal(masked.includes(secret), false);
  assert.equal(masked.startsWith("sk-t"), true);
  assert.equal(masked.endsWith("cdef"), true);
  assert.match(masked, /\*\*\*/);
});

test("vision chat body uses OpenAI-compatible image input", () => {
  const body = buildChatBody({
    model: "auto",
    text: "请描述这张图片",
    imageBase64: "abc123",
  });

  assert.equal(body.model, "auto");
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[0].content[0].type, "text");
  assert.equal(body.messages[0].content[1].type, "image_url");
  assert.equal(body.messages[0].content[1].image_url.url, "data:image/png;base64,abc123");
});

test("vision result classification detects unsupported image errors", () => {
  assert.deepEqual(
    classifyVisionResult({
      ok: false,
      status: 400,
      body: {
        error: {
          message: "unknown variant `image_url`, expected `text`",
        },
      },
    }),
    {
      supported: false,
      reason: "接口拒绝 image_url 图片格式",
    },
  );
});

test("user preferred model is tried before ranked model guesses", () => {
  assert.deepEqual(
    rankModelIds(["Qwen3.7-Max", "kimi-k2.6"], "deepseek-v4-flash").slice(0, 3),
    ["deepseek-v4-flash", "auto", "Qwen3.7-Max"],
  );
});

test("probe request timeout defaults to thirty seconds and accepts seconds", () => {
  assert.equal(resolveTimeoutMs({}), 30_000);
  assert.equal(resolveTimeoutMs({ timeout: "8" }), 8_000);
  assert.equal(resolveTimeoutMs({ timeout: "bad" }), 30_000);
});
