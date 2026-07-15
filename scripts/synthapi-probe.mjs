import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://synthapi.asia";
const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lGmJ9wAAAABJRU5ErkJggg==";

export function buildSynthApiEndpoints(baseUrl = DEFAULT_BASE_URL) {
  const normalized = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    baseUrl: normalized,
    modelsUrl: `${normalized}/v1/models`,
    chatUrl: `${normalized}/v1/chat/completions`,
  };
}

export function maskSecret(secret = "") {
  if (!secret) return "未填写";
  if (secret.length <= 8) return `${secret.slice(0, 1)}***${secret.slice(-1)}`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

export function buildChatBody({ model, text, imageBase64 } = {}) {
  const content = imageBase64
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ]
    : text;

  return {
    model,
    messages: [{ role: "user", content }],
    stream: false,
  };
}

export function classifyVisionResult(result) {
  if (result?.ok) return { supported: true, reason: "接口接受了图片并返回了回复" };

  const message = JSON.stringify(result?.body?.error || result?.body || result || "");
  if (/image_url|image|vision|modal|multimodal|图片|图像/i.test(message)) {
    return { supported: false, reason: "接口拒绝 image_url 图片格式" };
  }
  if (/model|模型|not found|does not exist|无效/i.test(message)) {
    return { supported: null, reason: "当前模型不可用，可能需要换模型名再测" };
  }
  return { supported: null, reason: "接口失败，但错误不像是明确不支持图片" };
}

export function resolveTimeoutMs(args = {}) {
  const seconds = Number.parseInt(args.timeout || process.env.SYNTHAPI_TIMEOUT_SECONDS || "", 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30_000;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    if (!input.isTTY || !output.isTTY) {
      output.write(question);
      let value = "";
      input.setEncoding("utf8");
      input.on("data", (chunk) => {
        value += chunk;
      });
      input.on("end", () => resolve(value.trim()));
      return;
    }

    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let value = "";
    const onData = (char) => {
      if (char === "\r" || char === "\n" || char === "\u0004") {
        output.write("\n");
        input.setRawMode(false);
        input.pause();
        input.off("data", onData);
        resolve(value);
        return;
      }
      if (char === "\u0003") {
        output.write("\n");
        process.exit(130);
      }
      if (char === "\b" || char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
      output.write("*");
    };
    input.on("data", onData);
  });
}

async function requestJson(url, apiKey, body, timeoutMs) {
  let response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return { ok: false, status: "timeout", body: { error: { message: `请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回` } } };
    }
    return { ok: false, status: "network", body: { error: { message: error?.message || "网络请求失败" } } };
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 600) };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

function extractModelIds(modelsResult) {
  const data = modelsResult?.body?.data;
  if (!Array.isArray(data)) return [];
  return data.map((item) => item?.id).filter(Boolean);
}

export function rankModelIds(ids, preferred) {
  const preferredList = preferred ? [preferred] : [];
  const guessed = [...new Set(["auto", "default", ...ids].filter(Boolean))]
    .filter((id) => id !== preferred)
    .sort((left, right) => scoreModel(right) - scoreModel(left));
  return [...preferredList, ...guessed];
}

function scoreModel(id) {
  const text = String(id).toLowerCase();
  let score = 0;
  if (text === "auto" || text.includes("auto")) score += 100;
  if (text.includes("vision") || text.includes("vl") || text.includes("image")) score += 80;
  if (text.includes("qwen") || text.includes("glm") || text.includes("doubao")) score += 40;
  if (text.includes("gemini") || text.includes("gpt-4o") || text.includes("claude")) score += 35;
  if (text.includes("deepseek")) score -= 20;
  return score;
}

function summarizeChat(result) {
  const content = result?.body?.choices?.[0]?.message?.content;
  const error = result?.body?.error?.message || result?.body?.message || result?.body?.error;
  return {
    ok: Boolean(result?.ok),
    status: result?.status,
    reply: typeof content === "string" ? content.slice(0, 160) : null,
    error: typeof error === "string" ? error.slice(0, 240) : error ? JSON.stringify(error).slice(0, 240) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoints = buildSynthApiEndpoints(args.base || process.env.SYNTHAPI_BASE_URL || DEFAULT_BASE_URL);
  const apiKey = args.key || process.env.SYNTHAPI_API_KEY || await promptHidden("请粘贴 SynthAPI 密钥（输入时会用 * 隐藏）：");
  const preferredModel = args.model || process.env.SYNTHAPI_MODEL || "";
  const timeoutMs = resolveTimeoutMs(args);

  if (!apiKey) {
    console.error("没有拿到密钥，已停止。");
    process.exitCode = 1;
    return;
  }

  console.log("测试地址：", endpoints.baseUrl);
  console.log("密钥状态：", maskSecret(apiKey));

  const modelsResult = await requestJson(endpoints.modelsUrl, apiKey, null, timeoutMs);
  const modelIds = extractModelIds(modelsResult);
  console.log("模型列表：", modelsResult.ok ? `成功，拿到 ${modelIds.length} 个模型` : `失败，HTTP ${modelsResult.status}`);
  if (modelIds.length) console.log("候选模型：", modelIds.slice(0, 12).join(", "));

  const candidates = rankModelIds(modelIds, preferredModel).slice(0, 6);
  console.log("将尝试模型：", candidates.join(", "));

  let workingText = null;
  for (const model of candidates) {
    const result = await requestJson(endpoints.chatUrl, apiKey, buildChatBody({ model, text: "请只回复：文字测试成功" }), timeoutMs);
    const summary = summarizeChat(result);
    console.log(`文字测试 ${model}：`, summary.ok ? `成功：${summary.reply}` : `失败 HTTP ${summary.status}：${summary.error || "无错误详情"}`);
    if (summary.ok) {
      workingText = model;
      break;
    }
  }

  const visionCandidates = rankModelIds(modelIds, preferredModel || workingText).slice(0, 8);
  let finalVision = null;
  for (const model of visionCandidates) {
    const result = await requestJson(
      endpoints.chatUrl,
      apiKey,
      buildChatBody({
        model,
        text: "这是一张 1x1 像素测试图片。请判断你是否成功接收到了图片，并用一句中文回答。",
        imageBase64: TEST_IMAGE_BASE64,
      }),
      timeoutMs,
    );
    const summary = summarizeChat(result);
    const classified = classifyVisionResult(result);
    console.log(`图片测试 ${model}：`, summary.ok ? `成功：${summary.reply}` : `失败 HTTP ${summary.status}：${summary.error || classified.reason}`);
    if (summary.ok || classified.supported === false) {
      finalVision = { model, summary, classified };
      if (summary.ok) break;
    }
  }

  console.log("\n结论：");
  if (finalVision?.summary?.ok) {
    console.log(`✅ 支持图片。可优先用模型：${finalVision.model}`);
  } else if (finalVision?.classified?.supported === false) {
    console.log(`❌ 当前测试到的模型不支持 OpenAI image_url 图片格式。最后测试模型：${finalVision.model}`);
  } else {
    console.log("⚠️ 还不能确定是否支持图片，可能需要中转站提供具体模型名。");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("测试器异常：", error?.message || error);
    process.exitCode = 1;
  });
}
