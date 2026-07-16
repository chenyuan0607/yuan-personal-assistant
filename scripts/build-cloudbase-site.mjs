import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC_FILES = ["index.html", "reset.html", "styles.css", "service-worker.js", "manifest.webmanifest"];
const PUBLIC_DIRECTORIES = ["js", "data", "icons", "assets"];

function normalizeApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("CloudBase test API must use HTTPS");
  return url.href.replace(/\/$/, "");
}

function injectAssistantApi(html, apiUrl) {
  if (/\bdata-assistant-api\s*=/.test(html)) return html.replace(/data-assistant-api="[^"]*"/, `data-assistant-api="${apiUrl}"`);
  const openingHtml = /<html\b([^>]*)>/i;
  if (!openingHtml.test(html)) throw new Error("index.html is missing an html element");
  return html.replace(openingHtml, `<html$1 data-assistant-api="${apiUrl}">`);
}

export async function buildCloudBaseSite({ sourceDir, outputDir, apiUrl }) {
  const normalizedApiUrl = normalizeApiUrl(apiUrl);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const name of PUBLIC_FILES) {
    const source = join(sourceDir, name);
    const destination = join(outputDir, name);
    if (name === "index.html") {
      const html = await readFile(source, "utf8");
      await writeFile(destination, injectAssistantApi(html, normalizedApiUrl), "utf8");
    } else {
      await cp(source, destination);
    }
  }
  for (const name of PUBLIC_DIRECTORIES) {
    await cp(join(sourceDir, name), join(outputDir, name), { recursive: true });
  }

  return { outputDir, apiUrl: normalizedApiUrl };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const sourceDir = dirname(dirname(scriptPath));
  const outputDir = join(sourceDir, "cloudbase-site-dist");
  const apiUrl = "https://yuan-assistant-test-d2bd198841e7.service.tcloudbase.com";
  buildCloudBaseSite({ sourceDir, outputDir, apiUrl })
    .then((result) => console.log(`Built CloudBase test site at ${result.outputDir}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
