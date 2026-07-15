import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../assistant-sync/config.mjs";
import { createEdgeOneClient } from "../assistant-sync/edgeone-client.mjs";
import { buildFeedbackReport } from "./report.mjs";

function beijingDate(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export function previousBeijingDate(now = new Date()) {
  const [year, month, day] = beijingDate(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export async function syncFeedback(env = process.env, {
  edgeFactory = createEdgeOneClient,
  now = new Date(),
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
  renameImpl = rename,
  rmImpl = rm,
} = {}) {
  const config = loadConfig(env);
  const edge = edgeFactory(config.edgeoneApiUrl, config.edgeoneToken);
  const cutoffDate = previousBeijingDate(now);
  const pulled = await edge.pullFeedback();
  const eligible = (pulled.items ?? []).filter((item) => item.date <= cutoffDate);
  const groups = new Map();
  for (const item of eligible) groups.set(item.date, [...(groups.get(item.date) ?? []), item]);
  const reports = [];
  for (const [date, items] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const localPath = join(config.knowledgeRoot, "00-inbox", "每日反馈", `${date}-任务与账本反馈.md`);
    const temporaryPath = `${localPath}.tmp`;
    const markdown = buildFeedbackReport({ date, items, syncedAt: now.toISOString() });
    await mkdirImpl(dirname(localPath), { recursive: true });
    await writeFileImpl(temporaryPath, markdown, "utf8");
    try { await renameImpl(temporaryPath, localPath); }
    catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      await rmImpl(localPath, { force: true });
      await renameImpl(temporaryPath, localPath);
    }
    await edge.ackFeedback(items.map((item) => item.id), localPath);
    reports.push({ date, items: items.length, localPath });
  }
  return { date: cutoffDate, items: eligible.length, reports, localPath: reports.find((item) => item.date === cutoffDate)?.localPath ?? "" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncFeedback().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
