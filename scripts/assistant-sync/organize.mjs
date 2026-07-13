export const safeName = (name) => name.replace(/[<>:"/\\|?*]/g, "_");
const bullets = (items = []) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";

export function buildDailyDocument({ date, summary, facts = [], decisions = [], followUps = [], sourceIds = [] }) {
  return `# ${date} 每日记录\n\n## 今日概况\n\n${summary}\n\n## 重要事实\n\n${bullets(facts)}\n\n## 决定与感悟\n\n${bullets(decisions)}\n\n## 待跟进\n\n${bullets(followUps)}\n\n## 来源编号\n\n${bullets(sourceIds)}\n`;
}

export function buildMemoryPack({ preferences = [], goals = [], status = [], rules = [], followUps = [] }) {
  return `# 手机助手记忆包\n\n## 沟通偏好\n${bullets(preferences)}\n\n## 当前目标\n${bullets(goals)}\n\n## 近期状态\n${bullets(status)}\n\n## 重要规则\n${bullets(rules)}\n\n## 待跟进\n${bullets(followUps)}\n`;
}
