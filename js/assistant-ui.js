import { createAssistantApi } from "./assistant-api.js";
import { createBrowserStore } from "./assistant-store.js";
import { formatChatTimeLabel, formatMessage, shouldShowTimeDivider } from "./assistant-view.js";
import { initAssistantTools } from "./assistant-tools.js";

const TITLE_KEY = "yuan-assistant-title";

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

export function parseStickerMessage(content) {
  const match = String(content || "").match(/^\[表情包:([^\]]{1,20})\]\((\.\/assets\/stickers\/[-A-Za-z0-9_./]+\.png)\)$/);
  return match ? { label: match[1], src: match[2] } : null;
}

function readImageDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/")) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressedImagePreview(file) {
  const source = await readImageDataUrl(file);
  if (!source) return null;
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    const maxSide = 520;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.78);
  } catch {
    return source.length < 350000 ? source : null;
  }
}

export async function refreshAssistantData(store, api, date) {
  const snapshot = await loadAssistantSnapshot(api, date);
  const hadPending = store.pending().length > 0;
  try {
    await flushPending(store, api);
    if (hadPending) return { ...(await loadAssistantSnapshot(api, date)), pendingError: null };
    return { ...snapshot, pendingError: null };
  } catch (error) {
    return { ...snapshot, pendingError: error };
  }
}

export function initAssistant({ baseUrl, root = document, store = createBrowserStore(), onSession = async () => {}, onMenu = () => {} }) {
  const api = createAssistantApi({ baseUrl, getToken: store.token });
  const dialog = root.querySelector("#assistant-login-dialog");
  const status = root.querySelector("#assistant-status");
  const list = root.querySelector("#assistant-messages");
  const title = root.querySelector("#assistant-title");
  const fileList = root.querySelector("#assistant-files");
  const memoryStatus = root.querySelector("#assistant-memory-status");
  const archiveStatus = root.querySelector("#assistant-archive-status");
  const enqueueText = async (text) => {
    store.enqueue({ id: crypto.randomUUID(), text, date: localDate(), createdAt: new Date().toISOString() });
    status.textContent = "对方正在输入···";
    render();
    await refresh();
  };
  const assistantTools = initAssistantTools({ root, status, onSticker: enqueueText });
  let serverMessages = [];
  const menuButton = root.querySelector("#assistant-menu");
  const showAssistantMenu = () => onMenu("assistant-menu-view");
  const titleStorage = root.defaultView?.localStorage || localStorage;
  const applyAssistantTitle = () => {
    title.textContent = titleStorage.getItem(TITLE_KEY) || "缘的小助手";
  };
  applyAssistantTitle();

  const createAvatarButton = () => {
    const stack = document.createElement("div");
    stack.className = "assistant-avatar-stack";
    const avatar = document.createElement("div");
    avatar.className = "assistant-avatar";
    const image = document.createElement("img");
    image.className = "assistant-avatar-image";
    image.src = assistantTools.getAvatarSource();
    image.alt = "AI 助手头像";
    avatar.append(image);
    stack.append(avatar);
    return stack;
  };

  const scrollLatestMessageIntoView = () => {
    const scrollToBottom = () => { list.scrollTop = list.scrollHeight; };
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
    setTimeout(scrollToBottom, 80);
  };

  const createThinkingMessage = (pending) => pending.length ? [{
    id: "assistant-thinking",
    role: "assistant",
    content: "对方正在输入···",
    date: localDate(),
    createdAt: new Date().toISOString(),
    sources: [],
    pending: true,
  }] : [];

  const openLogin = () => { if (!dialog.open) dialog.showModal(); };
  const render = () => {
    const known = new Set(serverMessages.map((item) => item.id));
    const pending = store.pending().filter((item) => !known.has(item.id)).map((item) => ({
      id: item.id, role: "user", content: item.text, date: item.date, createdAt: item.createdAt, sources: [], pending: true,
    }));
    let previousMessage = null;
    list.replaceChildren(...[...serverMessages, ...pending, ...createThinkingMessage(pending)].flatMap((raw) => {
      const message = formatMessage(raw);
      const nodes = [];
      if (shouldShowTimeDivider(previousMessage, raw)) {
        const divider = document.createElement("div");
        divider.className = "assistant-time-divider";
        divider.textContent = formatChatTimeLabel(raw.createdAt);
        nodes.push(divider);
      }
      previousMessage = raw;
      const row = document.createElement("div");
      row.className = `assistant-message-row ${message.role}`;
      const article = document.createElement("article");
      article.className = `assistant-message ${message.role}${raw.pending ? " pending" : ""}${message.attachment?.preview ? " image" : ""}`;
      const sticker = parseStickerMessage(message.content);
      if (sticker) {
        const image = document.createElement("img");
        image.className = "assistant-sticker-message";
        image.src = sticker.src;
        image.alt = sticker.label;
        article.append(image);
      } else if (message.attachment?.preview) {
        const image = document.createElement("img");
        image.className = "assistant-uploaded-image";
        image.src = message.attachment.preview;
        image.alt = message.attachment.name || "已上传图片";
        article.append(image);
      } else {
        const text = document.createElement("div"); text.textContent = message.content; article.append(text);
      }
      if (raw.pending && message.role === "assistant") { const note = document.createElement("small"); note.textContent = "对方正在输入···"; article.append(note); }
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
      nodes.push(row);
      return nodes;
    }));
    scrollLatestMessageIntoView();
  };

  const refresh = async () => {
    if (!store.token()) { openLogin(); return; }
    try {
      const { chatData, fileData, pendingError } = await refreshAssistantData(store, api, localDate());
      serverMessages = chatData.messages;
      render();
      renderFiles(fileData.files);
      memoryStatus.textContent = chatData.memory ? `记忆包：${chatData.memory.version}，更新于 ${chatData.memory.createdAt}` : "记忆包：尚未上传";
      archiveStatus.textContent = chatData.archive ? `今日对话：${chatData.archive.status}` : "今日对话：尚未归档";
      status.textContent = "两台手机已同步";
      if (pendingError) status.textContent = "AI 暂时无法回复，记忆包和历史已读取";
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
    const text = input.value;
    input.value = "";
    await enqueueText(text);
  });
  root.querySelector("#assistant-file").addEventListener("change", async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const form = new FormData(); form.append("file", file); status.textContent = "正在上传…";
    try {
      const fileData = await api.uploadFile(form);
      event.target.value = "";
      if (file.type.startsWith("image/") && fileData.file?.id) {
        status.textContent = "正在识图中…";
        const clientMessageId = crypto.randomUUID();
        const preview = await compressedImagePreview(file).catch(() => null);
        serverMessages = [...serverMessages, {
          id: clientMessageId,
          role: "user",
          content: "我发了一张图片，请帮我看看。",
          date: localDate(),
          createdAt: new Date().toISOString(),
          sources: [],
          pending: true,
          attachment: { id: fileData.file.id, name: file.name, type: file.type, preview },
        }];
        render();
        await api.sendImageMessage("我发了一张图片，请帮我看看。", fileData.file.id, localDate(), clientMessageId, preview);
      }
      await refresh();
    }
    catch (error) { status.textContent = error.message; }
  });
  menuButton.addEventListener("click", showAssistantMenu);
  root.querySelector("#assistant-menu-title")?.addEventListener("click", () => {
    const value = root.defaultView?.prompt("给聊天顶部改个备注", title.textContent)?.trim();
    if (!value) return;
    titleStorage.setItem(TITLE_KEY, value.slice(0, 24));
    applyAssistantTitle();
  });
  root.querySelector("#assistant-menu-notify")?.addEventListener("click", async () => {
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("这个浏览器暂时不支持主动通知");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("你还没有允许通知权限");
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await api.notificationKey();
      if (!publicKey) throw new Error("主动通知还没有配置推送密钥");
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api.saveNotificationSubscription(subscription.toJSON());
      await api.sendTestNotification().catch(() => null);
      status.textContent = "主动通知已开启";
    } catch (error) {
      status.textContent = error.message || "主动通知暂时无法开启";
    }
  });
  root.querySelector("#assistant-menu-avatar").addEventListener("click", () => {
    assistantTools.chooseAvatar();
  });
  root.querySelector("#assistant-menu-archive").addEventListener("click", async () => {
    status.textContent = "正在归档今天的对话…";
    try {
      await api.directArchive(localDate());
      status.textContent = "今天的对话已提交归档";
      await refresh();
    } catch (error) {
      status.textContent = error.message || "归档失败，请稍后再试";
    }
  });
  return refresh;
}
