import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CloudBase relay exposes file upload routes and mobile upload methods", async () => {
  const relay = await readFile(new URL("../cloudbase-functions/relay/index.js", import.meta.url), "utf8");

  assert.match(relay, /import filesHandler from "\.\.\/\.\.\/edge-functions\/api\/files\.js"/);
  assert.match(relay, /createCloudBaseBlob/);
  assert.match(relay, /YUAN_ASSISTANT_BLOB/);
  assert.match(relay, /\["\/api\/files", filesHandler\]/);
  assert.match(relay, /GET,POST,PATCH,DELETE,OPTIONS/);
  assert.match(relay, /20 \* 1024 \* 1024/);
});
