import { createServer } from "node:http";
import cloudbase from "@cloudbase/node-sdk";

import authHandler from "../../edge-functions/api/auth.js";
import chatHandler from "../../edge-functions/api/chat.js";
import feedbackHandler from "../../edge-functions/api/feedback.js";
import codexHandler from "../../edge-functions/api/codex.js";
import filesHandler from "../../edge-functions/api/files.js";
import { createCloudBaseBlob, createCloudBaseStore } from "./storage.js";

const app = cloudbase.init({ env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV });
const database = app.database();
const store = createCloudBaseStore({
  collection: database.collection(process.env.RELAY_COLLECTION || "yuan_relay_records"),
  regexp: (source) => database.RegExp({ regexp: source, options: "" }),
});
const fileStore = createCloudBaseBlob(app);

const handlers = new Map([
  ["/api/auth", authHandler],
  ["/api/chat", chatHandler],
  ["/api/feedback", feedbackHandler],
  ["/api/codex", codexHandler],
  ["/api/files", filesHandler],
]);

const env = new Proxy({}, {
  get: (_target, key) => {
    if (key === "YUAN_ASSISTANT_BLOB") return fileStore;
    return process.env[key];
  },
});

function corsOrigin(requestOrigin) {
  const allowed = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.includes(requestOrigin) ? requestOrigin : "";
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toRequest(req) {
  const host = req.headers.host || "localhost";
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  return new Request(`${protocol}://${host}${req.url}`, { method: req.method, headers: req.headers, body });
}

async function sendResponse(res, response, origin) {
  const headers = Object.fromEntries(response.headers.entries());
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function createRelayServer() {
  return createServer(async (req, res) => {
    const origin = corsOrigin(req.headers.origin || "");
    if (req.method === "OPTIONS") {
      if (!origin) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
        vary: "Origin",
      }).end();
      return;
    }

    try {
      const url = new URL(req.url, "https://relay.invalid");
      if (url.pathname === "/health") {
        await sendResponse(res, Response.json({ ok: true, service: "yuan-cloudbase-relay" }), origin);
        return;
      }
      const handler = handlers.get(url.pathname);
      if (!handler) {
        await sendResponse(res, Response.json({ ok: false, error: "Not Found" }, { status: 404 }), origin);
        return;
      }
      globalThis.YUAN_ASSISTANT_KV = store;
      await sendResponse(res, await handler({ request: await toRequest(req), env }), origin);
    } catch (error) {
      await sendResponse(res, Response.json({ ok: false, error: error.message }, { status: 500 }), origin);
    }
  });
}

if (process.env.NODE_ENV !== "test") {
  createRelayServer().listen(9000, "0.0.0.0");
}
