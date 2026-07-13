export function createEdgeOneClient(baseUrl, token, fetchImpl = fetch) {
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: { authorization: `Bearer ${token}`, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    });
    if (!response.ok) throw new Error(`EdgeOne请求失败: ${response.status}`);
    return response.headers.get("content-type")?.includes("application/json") ? response.json() : response.arrayBuffer();
  };
  return {
    pull: () => request("/api/codex?action=pull"),
    download: (id) => request("/api/codex?action=download", { method: "POST", body: JSON.stringify({ id }) }),
    ack: ({ id, kind, date }, localPath) => request("/api/codex?action=ack", { method: "POST", body: JSON.stringify({ id, kind, date, localPath }) }),
    uploadMemory: (content, version) => request("/api/codex?action=memory", { method: "POST", body: JSON.stringify({ content, version }) }),
    cleanup: () => request("/api/cleanup", { method: "POST", body: "{}" }),
  };
}
