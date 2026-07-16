function cleanTranscript(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function bytesToBase64(bytes) {
  const array = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : ArrayBuffer.isView(bytes)
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function downsamplePcm16(samples, inputRate, outputRate) {
  if (!samples?.length) return new Int16Array(0);
  if (outputRate >= inputRate) {
    const direct = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      direct[index] = Math.max(-1, Math.min(1, samples[index])) * 0x7fff;
    }
    return direct;
  }
  const ratio = inputRate / outputRate;
  const frameCount = Math.max(1, Math.floor(samples.length / ratio));
  const result = new Int16Array(frameCount);
  let inputOffset = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const nextOffset = Math.min(samples.length, Math.round((frame + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (; inputOffset < nextOffset; inputOffset += 1) {
      sum += samples[inputOffset];
      count += 1;
    }
    const average = count ? sum / count : 0;
    result[frame] = Math.max(-1, Math.min(1, average)) * 0x7fff;
  }
  return result;
}

function createAudioPlayer() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  let nextPlaybackTime = 0;
  let closed = false;

  const play = async (base64) => {
    if (closed) return;
    const bytes = base64ToBytes(base64);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;
    if (context.state === "suspended") await context.resume();
    const buffer = context.createBuffer(1, sampleCount, 24000);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < sampleCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32768;
    }
    if (nextPlaybackTime < context.currentTime + 0.04) nextPlaybackTime = context.currentTime + 0.04;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(nextPlaybackTime);
    nextPlaybackTime += buffer.duration;
    source.onended = () => source.disconnect();
  };

  const stop = async () => {
    closed = true;
    nextPlaybackTime = 0;
    if (context.state !== "closed") await context.close().catch(() => {});
  };

  return { play, stop };
}

async function createMicSender({ stream, socket }) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持语音通道");
  const context = new AudioContextClass();
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0;
  let enabled = true;

  processor.onaudioprocess = (event) => {
    if (!enabled || socket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm16 = downsamplePcm16(input, context.sampleRate, 16000);
    if (!pcm16.length) return;
    socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: bytesToBase64(new Uint8Array(pcm16.buffer)) }));
  };

  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);

  return {
    setEnabled(value) {
      enabled = Boolean(value);
    },
    async stop() {
      try { source.disconnect(); } catch {}
      try { processor.disconnect(); } catch {}
      try { sink.disconnect(); } catch {}
      await context.close().catch(() => {});
    },
  };
}

export function createTranscriptBuffer({ sessionId, date }) {
  const messages = [];
  const known = new Set();
  return {
    add({ role, content }) {
      const text = cleanTranscript(content);
      if (!sessionId || !date || !["user", "assistant"].includes(role) || !text) return null;
      const fingerprint = `${role}:${text}`;
      if (known.has(fingerprint)) return null;
      known.add(fingerprint);
      const message = { id: `${sessionId}-${messages.length + 1}`, role, content: text, date };
      messages.push(message);
      return message;
    },
    list() {
      return [...messages];
    },
  };
}

export function realtimeEventToTranscript(event) {
  const type = String(event?.type || "");
  const content = cleanTranscript(event?.transcript || event?.text || event?.delta || "");
  if (!content) return null;
  if (type === "conversation.item.input_audio_transcription.completed") return { role: "user", content };
  if (type === "response.audio_transcript.done" || type === "response.output_text.done") return { role: "assistant", content };
  return null;
}

const REALTIME_INSTRUCTIONS = [
  "你叫青青，是缘的私人网页 AI 助手。",
  "说话自然、温柔、像熟悉的姐姐或女朋友，不要机械客服口吻。",
  "聊天时可以轻松一点，先接住情绪，再给具体建议。",
  "不要在每句回复里主动带时间；只有用户明确问现在几点、今天几号或当前时间时才直接回答。",
].join("\n");

export function initRealtimeCall({ root = document, api, onExit = () => {} }) {
  const view = root.querySelector("#realtime-call-view");
  const status = root.querySelector("#realtime-call-status");
  const list = root.querySelector("#realtime-transcript");
  const current = root.querySelector("#realtime-current");
  const timer = root.querySelector("#realtime-call-view header span");
  const captionToggle = root.querySelector("#realtime-caption-toggle");
  const textToggle = root.querySelector("#realtime-text-toggle");
  const textForm = root.querySelector("#realtime-text-form");
  const textInput = root.querySelector("#realtime-text-input");
  const hangup = root.querySelector("#realtime-hangup");
  const startButton = root.querySelector("#assistant-call");

  let socket = null;
  let stream = null;
  let session = null;
  let buffer = null;
  let micSender = null;
  let audioPlayer = null;
  let ending = false;
  let textMode = false;
  let timerId = null;
  let startedAt = 0;

  const save = () => {
    const messages = buffer?.list() || [];
    if (!session?.id || !messages.length) return;
    api.saveRealtimeTranscript({ sessionId: session.id, date: messages[0].date, messages }).catch(() => {});
  };

  const push = (row) => {
    const item = buffer?.add(row);
    if (!item) return;
    current.textContent = item.content;
    const line = document.createElement("p");
    line.className = `realtime-line ${item.role}`;
    line.textContent = `${item.role === "user" ? "缘" : "青青"}：${item.content}`;
    list.append(line);
    list.scrollTop = list.scrollHeight;
    save();
  };

  const stop = async () => {
    if (ending) return;
    ending = true;
    if (timerId) clearInterval(timerId);
    timerId = null;
    try { micSender?.setEnabled(false); } catch {}
    try { socket?.close(1000, "hangup"); } catch {}
    try { await micSender?.stop(); } catch {}
    try { await audioPlayer?.stop(); } catch {}
    try { stream?.getTracks().forEach((track) => track.stop()); } catch {}
    save();
    view.hidden = true;
    onExit();
    ending = false;
  };

  const setTextMode = (enabled) => {
    textMode = Boolean(enabled);
    textForm.hidden = !textMode;
    micSender?.setEnabled(!textMode);
    status.textContent = textMode ? "文字输入中，麦克风已暂停" : socket ? "正在听你说话" : "正在连接…";
    if (textMode) textInput.focus();
  };

  const handleEvent = (event) => {
    const type = String(event?.type || "");
    if (type === "response.audio.delta" && audioPlayer) {
      audioPlayer.play(event.delta || event.audio || "");
      status.textContent = "青青正在说话";
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      status.textContent = "正在听你说话";
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      status.textContent = "青青正在说话";
      return;
    }
    const transcript = realtimeEventToTranscript(event);
    if (transcript) {
      push(transcript);
      status.textContent = transcript.role === "assistant" ? "正在听你说话" : "青青正在说话";
      return;
    }
    if (type === "response.audio_transcript.delta" || type === "conversation.item.input_audio_transcription.delta") {
      const preview = cleanTranscript(event.transcript || event.text || event.delta || "");
      if (preview) current.textContent = preview;
      return;
    }
    if (type === "error") {
      status.textContent = cleanTranscript(event.error?.message || event.message || "通话出了点问题");
    }
  };

  const startCall = async () => {
    view.hidden = false;
    view.classList.remove("captions");
    list.replaceChildren();
    current.textContent = "正在连接…";
    status.textContent = "正在连接…";
    timer.textContent = "00:00";
    textForm.hidden = true;
    textMode = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      session = await api.startRealtimeCall().then((result) => result.session);
      buffer = createTranscriptBuffer({
        sessionId: session.id,
        date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
      });
      audioPlayer = createAudioPlayer();
      socket = new WebSocket(session.url, session.protocols?.length ? session.protocols : undefined);
      socket.onopen = async () => {
        status.textContent = "正在听你说话";
        startedAt = Date.now();
        timer.textContent = "00:00";
        timerId = setInterval(() => {
          const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
          const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
          const seconds = String(elapsed % 60).padStart(2, "0");
          timer.textContent = `${minutes}:${seconds}`;
        }, 1000);
        socket.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: REALTIME_INSTRUCTIONS,
            voice: session.voice || "Tina",
            input_audio_format: "pcm",
            output_audio_format: "pcm",
            input_audio_transcription: { model: "qwen3-asr-flash-realtime" },
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
        }));
        micSender = await createMicSender({ stream, socket });
        micSender.setEnabled(!textMode);
      };
      socket.onmessage = (event) => {
        try {
          handleEvent(JSON.parse(event.data));
        } catch {}
      };
      socket.onerror = () => { status.textContent = "通话连接出了点问题"; };
      socket.onclose = () => { if (!ending) status.textContent = "通话已结束"; };
    } catch (error) {
      status.textContent = error?.name === "NotAllowedError"
        ? "没有麦克风权限，无法开始通话"
        : "通话暂时无法开始";
      await stop().catch(() => {});
    }
  };

  startButton.addEventListener("click", startCall);
  hangup.addEventListener("click", stop);
  captionToggle.addEventListener("click", () => view.classList.toggle("captions"));
  textToggle.addEventListener("click", () => setTextMode(textForm.hidden));
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
    push({ role: "user", content: text });
    socket.send(JSON.stringify({
      type: "conversation.item.create",
      item: { role: "user", content: [{ type: "input_text", text }] },
    }));
    socket.send(JSON.stringify({ type: "response.create" }));
    textInput.value = "";
  });
}
