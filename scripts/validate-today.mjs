import { readFile } from "node:fs/promises";
import { validatePlan } from "../js/tasks.js";
import { validateWeeklySummary } from "../js/weekly.js";

const path = new URL("../data/today.json", import.meta.url);
const raw = await readFile(path, "utf8");
const plan = validatePlan(JSON.parse(raw));
const weeklyRaw = await readFile(new URL("../data/weekly.json", import.meta.url), "utf8");
const weekly = validateWeeklySummary(JSON.parse(weeklyRaw));

const forbidden = [
  /D:\\/i,
  /缘的成长知识库/i,
  /(?:password|passwd|api[_ -]?key|secret|token)\s*[:=]/i,
  /\b\d{17}[\dXx]\b/,
];

for (const pattern of forbidden) {
  if (pattern.test(`${raw}\n${weeklyRaw}`)) throw new Error(`发布内容包含禁止发布的敏感内容：${pattern}`);
}

console.log(`发布内容校验通过：${plan.date}，${Object.values(plan.groups).flat().length} 项任务；周总结 ${weekly.weekStart}`);
