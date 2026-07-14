import { createAssistantApi } from "./assistant-api.js";
import { createBrowserStore } from "./assistant-store.js";
import { formatMessage } from "./assistant-view.js";
import { initAssistantTools } from "./assistant-tools.js";

export function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function flushPending(store, api) {
  for (const message of store.pending()) {
    await api.sendMessage(message.text, message.date, message.id);
    store.ack(message.id);
  }
}

export async function loadAssistantSnapshot(api, date) {
  const chatData = await api.listMessages(date);
  try {
    return { chatData, fileData: await api.listFiles(), fileAvailable: true };
  } catch {
    return { chatData, fileData: { files: [] }, fileAvailable: false };
  }
}

export function initAssistant({ baseUrl, root = document, store = createBrowserStore(), onSession = async () => {} }) {
  const api = createAssistantApi({ baseUrl, getToken: store.token });
  const dialog = root.querySelector("#assistant-login-dialog");
  const status = root.querySelector("#assistant-status");
  const list = root.querySelector("#assistant-messages");
  const fileList = root.querySelector("#assistant-files");
  const memoryStatus = root.querySelector("#assistant-memory-status");
  const archiveStatus = root.querySelector("#assistant-archive-status");
  const assistantTools = initAssistantTools({ root, status });
  let serverMessages = [];

  const createAvatarButton = () => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "assistant-avatar";
    button.setAttribute("aria-label", "更换 AI 头像");
    button.title = "更换 AI 头像";
    button.addEventListener("click", assistantTools.chooseAvatar);
    const image = document.createElement("img");
    image.className = "assistant-avatar-image";
    image.src = assistantTools.getAvatarSource();
    image.alt = "AI 助手头像";
    button.append(image);
    return button;
  };

  const openLogin = () => { if (!dialog.open) dialog.showModal(); };
  const render = () => {
    const known = new Set(serverMessages.map((item) => item.id));
    const pending = store.pending().filter((item) => !known.has(item.id)).map((item) => ({
      id: item.id, role: "user", content: item.text, date: item.date, createdAt: item.createdAt, sources: [], pending: true,
    }));
    list.replaceChildren(...[...serverMessages, ...pending].map((raw) => {
      const message = formatMessage(raw);
      const row = document.createElement("div");
      row.className = `assistant-message-row ${message.role}`;
      const article = document.createElement("article");
      article.className = `assistant-message ${message.role}${raw.pending ? " pending" : ""}`;
      const text = document.createElement("div"); text.textContent = message.content; article.append(text);
      if (raw.pending) { const note = document.createElement("small"); note.textContent = "正在思考中"; article.append(note); }
      if (message.sources.length) {
        const sources = document.createElement("div"); sources.className = "assistant-sources";
        for (const source of message.sources) {
          const href = safeSourceUrl(source.url); if (!href) continue;
          const link = document.createElement("a"); link.href = href; link.target = "_blank"; link.rel = "noreferrer";
          link.textContent = `${source.title || "来源"}${source.date ? ` · ${source.date}` : ""}`; sources.append(link);
        }
        article.append(sources);
      }
      if (message.role === "assistant") row.append(createAvatarButton());
      row.append(article);
      return row;
    }));
    list.scrollTop = list.scrollHeight;
  };

  const refresh = async () => {
    if (!store.token()) { openLogin(); return; }
    try {
      await flushPending(store, api);
      const { chatData, fileData } = await loadAssistantSnapshot(api, localDate());
      serverMessages = chatData.messages;
      render();
      renderFiles(fileData.files);
      memoryStatus.textContent = chatData.memory ? `记忆包：${chatData.memory.version}，更新于 ${chatData.memory.createdAt}` : "记忆包：尚未上传";
      archiveStatus.textContent = chatData.archive ? `今日对话：${chatData.archive.status}` : "今日对话：尚未归档";
      status.textContent = "两台手机已同步";
    } catch (error) {
      render();
      if (error.status === 401) { store.clearToken(); openLogin(); status.textContent = "请重新输入访问码"; }
      else status.textContent = "网络暂时不可用，未发送内容已安全留在本机";
    }
  };

  const renderFiles = (files) => {
    fileList.replaceChildren(...files.map((file) => {
      const row = document.createElement("div"); row.className = "assistant-file-row";
      const label = document.createElement("span"); label.textContent = `${file.name} · ${file.status}${file.keep ? " · 长期保留" : ""}`;
      const actions = document.createElement("div"); actions.className = "assistant-file-actions";
      for (const [action, text] of [["keep", "长期保留"], ["retry", "重新处理"], ["delete", "立即删除"]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "text-button"; button.textContent = text;
        button.addEventListener("click", async () => { await api.updateFile(file.id, action); await refresh(); });
        actions.append(button);
      }
      row.append(label, actions); return row;
    }));
  };

  root.querySelector("#assistant-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const deviceName = root.querySelector("#assistant-device-name").value;
      const data = await api.login(root.querySelector("#assistant-access-code").value, deviceName);
      store.setSession({ token: data.token, deviceName }); root.querySelector("#assistant-access-code").value = ""; dialog.close(); await onSession(); await refresh();
    } catch (error) { status.textContent = error.message; }
  });
  root.querySelector("#assistant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = root.querySelector("#assistant-input");
    store.enqueue({ id: crypto.randomUUID(), text: input.value, date: localDate(), createdAt: new Date().toISOString() });
    input.value = ""; status.textContent = "正在思考中"; render(); await refresh();
  });
  root.querySelector("#assistant-file").addEventListener("change", async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const form = new FormData(); form.append("file", file); status.textContent = "正在上传…";
    try { await api.uploadFile(form); event.target.value = ""; await refresh(); }
    catch (error) { status.textContent = error.message; }
  });
  root.querySelector("#assistant-lock").addEventListener("click", () => { store.clearToken(); openLogin(); });
  return refresh;
}
