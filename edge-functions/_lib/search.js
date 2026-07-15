const currentInformation = /((今天|最新|现在).*(新闻|价格|政策|天气|汇率|版本)|(新闻|政策|天气|汇率).*(今天|最新|现在)|价格.*(多少|如何|变化)|版本.*(多少|最新))/;

export function needsSearch(text) {
  if (/不要联网|不用搜索/.test(text)) return false;
  if (/联网查|搜索一下|网上查/.test(text)) return true;
  return currentInformation.test(text);
}

export async function searchWeb(query, env) {
  if (!env.SEARCH_ENDPOINT) return [];
  const response = await fetch(env.SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.SEARCH_API_KEY}`,
    },
    body: JSON.stringify({ query, limit: 5 }),
  });
  if (!response.ok) throw new Error("联网搜索暂时不可用");
  const payload = await response.json();
  return (payload.results ?? []).map(({ title, url, snippet, date }) => ({ title, url, snippet, date }));
}
