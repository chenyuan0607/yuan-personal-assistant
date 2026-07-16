import test from "node:test";
import assert from "node:assert/strict";

import { createTranscriptBuffer, realtimeEventToTranscript } from "../js/realtime-call.js";
import { createAssistantApi } from "../js/assistant-api.js";
import realtimeHandler from "../edge-functions/api/realtime.js";
import { issueToken } from "../edge-functions/_lib/crypto.js";

test("realtime transcripts retain finalized speaker text once", () => {
  const buffer = createTranscriptBuffer({ sessionId: "call-12345678", date: "2026-07-16" });
  const first = buffer.add({ role: "user", content: "你好青青" });
  const duplicate = buffer.add({ role: "user", content: "你好青青" });
  const answer = buffer.add({ role: "assistant", content: "我在呀。" });

  assert.deepEqual(first, { id: "call-12345678-1", role: "user", content: "你好青青", date: "2026-07-16" });
  assert.equal(duplicate, null);
  assert.deepEqual(answer, { id: "call-12345678-2", role: "assistant", content: "我在呀。", date: "2026-07-16" });
  assert.deepEqual(buffer.list(), [first, answer]);
});

test("Alibaba realtime completion events become transcript rows", () => {
  assert.deepEqual(realtimeEventToTranscript({ type: "conversation.item.input_audio_transcription.completed", transcript: "今天天气怎么样" }), {
    role: "user",
    content: "今天天气怎么样",
  });
  assert.deepEqual(realtimeEventToTranscript({ type: "response.audio_transcript.done", transcript: "六枝今天很舒服。" }), {
    role: "assistant",
    content: "六枝今天很舒服。",
  });
  assert.equal(realtimeEventToTranscript({ type: "response.audio.delta", delta: "..." }), null);
});

test("assistant API requests a short call session and stores its text", async () => {
  const calls = [];
  const api = createAssistantApi({
    baseUrl: "https://assistant.example",
    getToken: () => "token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, session: {}, saved: 2 }), { headers: { "content-type": "application/json" } });
    },
  });

  await api.startRealtimeCall();
  await api.saveRealtimeTranscript({ sessionId: "call-12345678", date: "2026-07-16", messages: [{ id: "call-12345678-1", role: "user", content: "你好" }] });

  assert.equal(calls[0].url, "https://assistant.example/api/realtime");
  assert.equal(calls[0].options.headers.authorization, "Bearer token");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    sessionId: "call-12345678",
    date: "2026-07-16",
    messages: [{ id: "call-12345678-1", role: "user", content: "你好" }],
  });
});

test("realtime endpoint exchanges the long-lived Alibaba key only on the server", async () => {
  const secret = "session-secret";
  const token = await issueToken({ sub: "owner", kind: "device", exp: 2_000_000_000 }, secret, 1_000);
  const calls = [];
  const response = await realtimeHandler({
    request: new Request("https://assistant.example/api/realtime", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    }),
    env: {
      SESSION_SECRET: secret,
      REALTIME_API_KEY: "never-send-this-key-to-browser",
      REALTIME_SESSION_ENDPOINT: "https://realtime.example/sessions",
      REALTIME_FETCH: async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ id: "provider-session", client_secret: { value: "temporary-browser-token" }, url: "wss://realtime.example/live" }), { headers: { "content-type": "application/json" } });
      },
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls[0].options.headers.authorization, "Bearer never-send-this-key-to-browser");
  assert.equal(body.session.id, "provider-session");
  assert.equal(body.session.url, "wss://realtime.example/live");
  assert.equal(body.session.clientSecret, "temporary-browser-token");
  assert.doesNotMatch(JSON.stringify(body), /never-send-this-key-to-browser/);
});

test("realtime endpoint can return a deployed proxy websocket url", async () => {
  const secret = "session-secret";
  const token = await issueToken({ sub: "owner", kind: "device", exp: 2_000_000_000 }, secret, 1_000);
  const response = await realtimeHandler({
    request: new Request("https://assistant.example/api/realtime", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    }),
    env: {
      SESSION_SECRET: secret,
      REALTIME_PROXY_WS_URL: "ws://omni-realtime.example/ws",
      REALTIME_VOICE: "Cherry",
    },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.session.url, "ws://omni-realtime.example/ws?voice=Cherry");
  assert.equal(body.session.voice, "Cherry");
  assert.equal(body.session.clientSecret, "");
});
