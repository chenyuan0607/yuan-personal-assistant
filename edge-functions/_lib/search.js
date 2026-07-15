const currentInformation = /((今天|最新|现在|最近|当前).*(新闻|价格|政策|天气|汇率|版本|热点|热榜|流行|趋势|报名|截止|考试|平台|软件|规则)|(新闻|政策|天气|汇率|热点|热榜|流行|趋势|报名|截止|考试|平台|软件|规则).*(今天|最新|现在|最近|当前)|价格.*(多少|如何|变化)|版本.*(多少|最新)|报名.*(截止|时间|入口)|截止了吗|抖音.*(热点|热榜|流行|趋势)|小红书.*(热点|热榜|流行|趋势))/;

export function needsSearch(text) {
  if (/不要联网|不用搜索/.test(text)) return false;
  if (/联网查|搜索一下|网上查/.test(text)) return true;
  return currentInformation.test(text);
}

const normalizeResults = (payload) => {
  const items = Array.isArray(payload?.results) ? payload.results
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload) ? payload
        : [];
  return items.slice(0, 5).map((item) => ({
    title: item.title || item.name || "搜索结果",
    url: item.url || item.link || "",
    snippet: item.snippet || item.content || item.description || "",
    date: item.date || item.publishedDate || item.published_at || "",
  })).filter((item) => item.title || item.url || item.snippet);
};

const decodeHtml = (text = "") => text
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const cleanHtmlText = (html = "") => decodeHtml(html.replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

const normalizeBingUrl = (url = "") => {
  const decoded = decodeHtml(url);
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("bing.com") && parsed.pathname === "/ck/a") {
      const target = parsed.searchParams.get("u");
      if (target) return target.startsWith("a1") ? atob(target.slice(2)) : target;
    }
  } catch {}
  return decoded;
};

const parseSearchHtml = (html) => {
  const results = [];
  const blocks = [
    ...(html.match(/<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) || []),
    ...(html.match(/<li\b[^>]*class="[^"]*\bres-list\b[^"]*"[\s\S]*?<\/li>/gi) || []),
  ];
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<h3[^>]*>\s*<a[^>]+(?:href="([^"]+)"[^>]*data-mdurl="([^"]+)"|data-mdurl="([^"]+)"[^>]*href="([^"]+)")[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = link[5] ? (link[2] || link[3] || link[1]) : link[1];
    const title = link[5] || link[2];
    const snippet = block.match(/<p[^>]*class="[^"]*(?:res-desc)[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      title: cleanHtmlText(title) || "搜索结果",
      url: normalizeBingUrl(url),
      snippet: snippet ? cleanHtmlText(snippet[1]) : "",
      date: "",
    });
  }
  return results.slice(0, 5).filter((item) => item.url);
};

async function defaultSearch(query) {
  const lightweight = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
    headers: { accept: "application/json" },
  });
  if (lightweight.ok) {
    const results = normalizeResults(await lightweight.json());
    if (results.length) return results;
  }
  const searchPages = [
    `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    `https://www.so.com/s?q=${encodeURIComponent(query)}`,
  ];
  for (const url of searchPages) {
    const response = await fetch(url, {
      headers: {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 YuanAssistant/1.0",
      },
    });
    if (!response.ok) continue;
    const results = parseSearchHtml(await response.text());
    if (results.length) return results;
  }
  throw new Error("联网搜索暂时不可用");
}

export async function searchWeb(query, env) {
  const hasProvider = Boolean(env.SEARCH_ENDPOINT);
  if (!hasProvider) return defaultSearch(query);
  const response = await fetch(env.SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.SEARCH_API_KEY ? { authorization: `Bearer ${env.SEARCH_API_KEY}` } : {}),
      },
      body: JSON.stringify({ query, limit: 5 }),
    });
  if (!response.ok) throw new Error("联网搜索暂时不可用");
  const payload = await response.json();
  return normalizeResults(payload);
}
