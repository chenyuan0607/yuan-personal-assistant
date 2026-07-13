import { readFile } from "node:fs/promises";
import { validatePlan } from "../js/tasks.js";

const path = new URL("../data/today.json", import.meta.url);
const raw = await readFile(path, "utf8");
const plan = validatePlan(JSON.parse(raw));

const forbidden = [
  /D:\\/i,
  /缘的成长知识库/i,
  /(?:password|passwd|api[_ -]?key|secret|token)\s*[:=]/i,
  /\b\d{17}[\dXx]\b/,
];

for (const pattern of forbidden) {
  if (pattern.test(raw)) throw new Error(`今日任务包含禁止发布的敏感内容：${pattern}`);
}

console.log(`今日任务校验通过：${plan.date}，${Object.values(plan.groups).flat().length} 项任务`);
