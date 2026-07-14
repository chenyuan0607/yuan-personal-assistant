export function buildModelMessages({ memory = "", history = [], userText, sources = [], currentTime = "" }) {
  const sourceText = sources
    .map((item, index) => `[${index + 1}] ${item.title} ${item.url}\n日期：${item.date || "未注明"}\n${item.snippet || ""}`)
    .join("\n");
  return [
    {
      role: "system",
      content: `你是缘的私人网页助手。回答直接、清楚，不读取或推测账本数据。当前时间：${currentTime || "未提供"}。如果用户问现在几点、今天几号、当前日期或当前时间，必须直接根据这里的当前时间回答，不要说你无法获取时间。\n长期记忆：\n${memory || "暂无"}\n联网资料：\n${sourceText || "未联网"}`,
    },
    ...history.slice(-30).map(({ role, content }) => ({ role, content })),
    { role: "user", content: userText },
  ];
}

export function buildArchiveMessages(history, date) {
  return [
    {
      role: "system",
      content: "把当天对话整理成简洁Markdown。只保留事实、决定、感受、计划和待跟进事项；不要编造，也不要包含账本数据。",
    },
    {
      role: "user",
      content: `日期：${date}\n\n${history.map(({ role, content }) => `${role}: ${content}`).join("\n")}`,
    },
  ];
}

export async function callModel(messages, env) {
  const response = await fetch(env.MODEL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.MODEL_API_KEY}`,
    },
    body: JSON.stringify({ model: env.MODEL_NAME, messages, stream: false }),
  });
  if (!response.ok) throw new Error("AI暂时无法回答");
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content ?? payload.output_text ?? "";
  if (!content) throw new Error("AI没有返回内容");
  return content;
}
