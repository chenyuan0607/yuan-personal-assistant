export function createImaClient({ clientId, apiKey, fetchImpl = fetch }) {
  const post = async (path, body) => {
    const response = await fetchImpl(`https://ima.qq.com${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "ima-openapi-clientid": clientId, "ima-openapi-apikey": apiKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`IMA网络错误: ${response.status}`);
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.msg || `IMA错误 ${payload.code}`);
    return payload.data;
  };
  return {
    async importNote(markdown, folderId = "") {
      const data = await post("/openapi/note/v1/import_doc", { content_format: 1, content: markdown, ...(folderId ? { folder_id: folderId } : {}) });
      return data.note_id;
    },
    async addNoteToKnowledgeBase({ noteId, title, knowledgeBaseId, folderId = "" }) {
      const data = await post("/openapi/wiki/v1/add_knowledge", {
        media_type: 11,
        title,
        knowledge_base_id: knowledgeBaseId,
        note_info: { content_id: noteId },
        ...(folderId ? { folder_id: folderId } : {}),
      });
      return data.media_id;
    },
  };
}
