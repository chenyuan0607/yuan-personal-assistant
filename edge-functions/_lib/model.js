export function buildModelMessages({ memory = "", history = [], userText, sources = [], currentTime = "", searchNote = "" }) {
  const sourceText = sources
    .map((item, index) => `[${index + 1}] ${item.title} ${item.url}\n日期：${item.date || "未注明"}\n${item.snippet || ""}`)
    .join("\n");
  return [
    {
      role: "system",
      content: `你是缘的私人网页助手。回答直接、清楚，不读取或推测账本数据。当前时间：${currentTime || "未提供"}。这个时间是用户所在地北京时间，必须当作当前真实时间使用；如果用户问现在几点、今天几号、当前日期或当前时间，必须直接根据这里的当前时间回答，不要换算成 UTC，也不要说你无法获取时间。\n长期记忆：\n${memory || "暂无"}\n联网资料：\n${sourceText || "未联网"}${searchNote ? `\n联网状态：${searchNote}` : ""}`,
    },
    ...history.slice(-30).map(({ role, content }) => ({ role, content })),
    { role: "user", content: `${currentTime ? `【当前北京时间】${currentTime}\n` : ""}${userText}` },
  ];
}

export function buildImageUnderstandingMessages({ imageUrl, userText }) {
  return [
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: `${userText || "请帮我看看这张图片。"}\n\n请先提取图片里的关键信息、文字和可见细节，再用简洁中文说明。` },
      ],
    },
  ];
}

export function buildImageReplyMessages({ memory = "", history = [], userText, imageSummary, currentTime = "" }) {
  return buildModelMessages({
    memory,
    history,
    userText: `用户发送了一张图片，并说：${userText}\n\n视觉模型识别结果：\n${imageSummary}\n\n请结合图片识别结果回复用户。`,
    sources: [],
    currentTime,
  });
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

export async function callVisionModel(messages, env) {
  if (!env.VISION_MODEL_ENDPOINT || !env.VISION_MODEL_API_KEY || !env.VISION_MODEL_NAME) {
    throw new Error("识图模型尚未配置");
  }
  const response = await fetch(env.VISION_MODEL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.VISION_MODEL_API_KEY}`,
    },
    body: JSON.stringify({ model: env.VISION_MODEL_NAME, messages, thinking: { type: "disabled" }, stream: false }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload.error?.message || payload.message || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`识图暂时无法完成${detail ? `：${String(detail).slice(0, 80)}` : ""}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content ?? payload.output_text ?? "";
  if (!content) throw new Error("识图模型没有返回内容");
  return content;
}
