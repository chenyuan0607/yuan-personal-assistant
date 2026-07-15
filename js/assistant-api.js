export function createAssistantApi({ baseUrl, getToken, fetchImpl = fetch }) {
  const request = async (path, options = {}) => {
    const headers = {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${getToken() || ""}`,
      ...options.headers,
    };
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers });
    let data;
    try { data = await response.json(); }
    catch { data = { ok: response.ok, error: response.ok ? "" : "请求失败" }; }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "请求失败");
      error.status = response.status;
      throw error;
    }
    return data;
  };
  return {
    hasToken: () => Boolean(getToken()),
    login: (accessCode, deviceName) => request("/api/auth", { method: "POST", body: JSON.stringify({ accessCode, deviceName }) }),
    listMessages: (date) => request(`/api/chat?date=${encodeURIComponent(date)}`),
    sendMessage: (text, date, clientMessageId) => request(`/api/chat?date=${encodeURIComponent(date)}`, { method: "POST", body: JSON.stringify({ text, clientMessageId }) }),
    sendImageMessage: (text, fileId, date, clientMessageId, preview = null) => request(`/api/chat?date=${encodeURIComponent(date)}`, { method: "POST", body: JSON.stringify({ text, fileId, clientMessageId, ...(preview ? { preview } : {}) }) }),
    previewArchive: (date) => request("/api/chat?action=archive-preview", { method: "POST", body: JSON.stringify({ date }) }),
    directArchive: (date) => request("/api/chat?action=archive-direct", { method: "POST", body: JSON.stringify({ date }) }),
    listFiles: () => request("/api/files"),
    uploadFile: (formData) => request("/api/files", { method: "POST", body: formData }),
    updateFile: (id, action) => request("/api/files", { method: "PATCH", body: JSON.stringify({ id, action }) }),
    saveFeedback: (record) => request("/api/feedback", { method: "POST", body: JSON.stringify(record) }),
    listFeedback: (date) => request(`/api/feedback?date=${encodeURIComponent(date)}`),
    notificationKey: () => request("/api/notifications?action=key"),
    saveNotificationSubscription: (subscription) => request("/api/notifications?action=subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
    sendTestNotification: () => request("/api/notifications?action=test", { method: "POST", body: "{}" }),
    listWorkNotifications: () => request("/api/work-notifications?resource=work-notifications"),
  };
}
