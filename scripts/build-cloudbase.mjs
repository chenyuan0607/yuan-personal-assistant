import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = new URL("../cloudbase-dist/yuan-relay/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("../cloudbase-functions/relay/index.js", import.meta.url))],
  outfile: fileURLToPath(new URL("index.js", output)),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["@cloudbase/node-sdk", "web-push"],
});
await writeFile(new URL("package.json", output), `${JSON.stringify({
  name: "yuan-cloudbase-relay",
  private: true,
  type: "module",
  dependencies: { "@cloudbase/node-sdk": "3.18.3", "web-push": "3.6.7", ws: "8.18.3" },
}, null, 2)}\n`, "utf8");
await writeFile(new URL("scf_bootstrap", output), "#!/bin/bash\nnode index.js\n", "utf8");
