const AVATAR_KEY = "yuan-assistant-avatar";

export function createAssistantPreferences(storage = localStorage) {
  return {
    avatar: () => storage.getItem(AVATAR_KEY),
    setAvatar(value) {
      if (!/^data:image\/(?:png|jpe?g|webp);base64,/.test(value) || value.length > 350000) throw new Error("头像必须是较小的图片");
      storage.setItem(AVATAR_KEY, value);
    },
  };
}

export function assistantAvatarSource(preferences) {
  return preferences.avatar() || "./icons/icon-192.png";
}

export function createSpeechController({ Recognition, getValue, setValue, onState = () => {} }) {
  if (!Recognition) return { supported: false, start() { onState("unsupported"); }, stop() {} };
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const words = event.results?.[0]?.[0]?.transcript?.trim();
    if (words) setValue([getValue().trim(), words].filter(Boolean).join(" "));
    onState("done");
  };
  recognition.onerror = () => onState("error");
  recognition.onend = () => onState("idle");
  return {
    supported: true,
    recognition,
    start() { onState("listening"); recognition.start(); },
    stop() { recognition.stop(); },
  };
}

export const emptyStickerMessage = (manifest) => manifest.stickers?.length ? "" : "还没有表情包素材";

async function resizeAvatar(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = source;
  });
  const size = 256; const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const scale = Math.max(size / image.width, size / image.height);
  const width = image.width * scale; const height = image.height * scale;
  canvas.getContext("2d").drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL("image/webp", 0.82);
}

export function initAssistantTools({ root = document, status, storage = localStorage, fetchImpl = fetch } = {}) {
  const input = root.querySelector("#assistant-input");
  const preferences = createAssistantPreferences(storage);
  const avatarFile = root.querySelector("#assistant-avatar-file");
  avatarFile.addEventListener("change", async () => {
    try {
      const value = await resizeAvatar(avatarFile.files?.[0]); preferences.setAvatar(value);
      root.querySelectorAll(".assistant-avatar-image").forEach((image) => { image.src = value; });
    } catch (error) { status.textContent = error.message; }
    avatarFile.value = "";
  });

  const stickerButton = root.querySelector("#assistant-stickers");
  const stickerPanel = root.querySelector("#assistant-sticker-panel");
  stickerButton.addEventListener("click", async () => {
    stickerPanel.hidden = !stickerPanel.hidden;
    if (stickerPanel.hidden || stickerPanel.dataset.loaded) return;
    try {
      const manifest = await (await fetchImpl("./assets/stickers/manifest.json")).json();
      stickerPanel.textContent = emptyStickerMessage(manifest);
      stickerPanel.dataset.loaded = "true";
    } catch { stickerPanel.textContent = "表情包素材暂时无法读取"; }
  });

  return {
    getAvatarSource: () => assistantAvatarSource(preferences),
    chooseAvatar: () => avatarFile.click(),
  };
}
