import test from "node:test";
import assert from "node:assert/strict";

import { createCloudBaseStore } from "../cloudbase-functions/relay/storage.js";

function createFakeCollection() {
  const values = new Map();
  return {
    values,
    doc(id) {
      return {
        async get() { return { data: values.has(id) ? [values.get(id)] : [] }; },
        async set(value) { values.set(id, value); },
        async remove() { values.delete(id); },
      };
    },
    where(query) {
      let offset = 0;
      let size = 100;
      return {
        orderBy() { return this; },
        limit(value) { size = value; return this; },
        skip(value) { offset = value; return this; },
        async get() {
          const data = [...values.values()]
            .filter((item) => item.key.startsWith(query.key.source.replace("^", "")))
            .sort((left, right) => left.key.localeCompare(right.key));
          return { data: data.slice(offset, offset + size) };
        },
      };
    },
  };
}

test("CloudBase store preserves the EdgeOne KV contract", async () => {
  const collection = createFakeCollection();
  const store = createCloudBaseStore({ collection, regexp: (source) => ({ source }) });

  await store.put("chat_owner_1", JSON.stringify({ id: "1", createdAt: "2026-07-14T01:00:00Z" }));
  assert.deepEqual(await store.get("chat_owner_1", { type: "json" }), { id: "1", createdAt: "2026-07-14T01:00:00Z" });

  await store.put("chat_owner_1", JSON.stringify({ id: "1", content: "updated" }));
  assert.equal((await store.get("chat_owner_1", { type: "json" })).content, "updated");

  await store.put("feedback_owner_1", JSON.stringify({ id: "feedback-1" }));
  const page = await store.list({ prefix: "chat_owner_", limit: 10 });
  assert.deepEqual(page.keys, [{ key: "chat_owner_1" }]);
  assert.equal(page.complete, true);

  await store.delete("chat_owner_1");
  assert.equal(await store.get("chat_owner_1"), null);
});

test("CloudBase store paginates with an opaque numeric cursor", async () => {
  const collection = createFakeCollection();
  const store = createCloudBaseStore({ collection, regexp: (source) => ({ source }) });
  await store.put("item_1", "one");
  await store.put("item_2", "two");

  const first = await store.list({ prefix: "item_", limit: 1 });
  assert.equal(first.complete, false);
  assert.equal(first.cursor, "1");
  const second = await store.list({ prefix: "item_", limit: 1, cursor: first.cursor });
  assert.equal(second.complete, true);
});
