export function loadConfig(env = process.env, { requireIma = false } = {}) {
  const required = [
    "EDGEONE_API_URL",
    "EDGEONE_CODEX_TOKEN",
    "YUAN_KB_ROOT",
    ...(requireIma ? ["IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY", "IMA_KNOWLEDGE_BASE_ID"] : []),
  ];
  for (const name of required) if (!env[name]) throw new Error(`缺少配置 ${name}`);
  return {
    edgeoneApiUrl: env.EDGEONE_API_URL.replace(/\/$/, ""),
    edgeoneToken: env.EDGEONE_CODEX_TOKEN,
    knowledgeRoot: env.YUAN_KB_ROOT,
    imaClientId: env.IMA_OPENAPI_CLIENTID || "",
    imaApiKey: env.IMA_OPENAPI_APIKEY || "",
    imaKnowledgeBaseId: env.IMA_KNOWLEDGE_BASE_ID || "",
    imaFolderId: env.IMA_FOLDER_ID || "",
  };
}
