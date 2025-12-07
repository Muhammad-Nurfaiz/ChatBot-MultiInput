/* =========================================================
     STATE MANAGEMENT
========================================================= */
let currentPreview = {
  image: { file: null, name: null, data: null },
  document: { file: null, name: null, size: null },
  audio: { file: null, name: null, duration: null },
};

/* =========================================================
     DOM ELEMENTS
========================================================= */
const messageInput = document.getElementById("messageInput");
const chatContainer = document.getElementById("chatContainer");
const emptyState = document.getElementById("emptyState");
const previewArea = document.getElementById("previewArea");

/* =========================================================
     INTRO MESSAGE ON LOAD
========================================================= */
window.addEventListener("DOMContentLoaded", () => {
  addChatBubble(
    "Halo! Saya asisten AI. Saya dapat menjawab pertanyaan, menganalisis gambar, mengekstrak teks dari dokumen, dan mentranskripsi audio. Silakan kirim pesan atau unggah file untuk memulai.",
    "bot"
  );

  emptyState?.classList.add("hidden");
  setTimeout(() => (chatContainer.scrollTop = chatContainer.scrollHeight), 120);
});

/* =========================================================
     TEXTAREA AUTO GROW
========================================================= */
messageInput.addEventListener("input", autoGrow);
function autoGrow() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
}

/* Enter to Send */
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

/* =========================================================
     UPLOAD HANDLERS
========================================================= */
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (x) => {
    currentPreview.image = { file, name: file.name, data: x.target.result };
    updatePreviewArea();
  };
  reader.readAsDataURL(file);
}

function handleDocumentUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  currentPreview.document = { file, name: file.name, size: file.size };
  updatePreviewArea();
}

function handleAudioUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const audio = new Audio(URL.createObjectURL(file));
  audio.onloadedmetadata = () => {
    currentPreview.audio = {
      file,
      name: file.name,
      duration: Math.floor(audio.duration),
    };
    updatePreviewArea();
  };
}

/* =========================================================
     PREVIEW AREA HANDLER
========================================================= */
function updatePreviewArea() {
  previewArea.innerHTML = "";

  // IMAGE
  if (currentPreview.image.file) {
    previewArea.innerHTML += `
      <div class="preview-box">
        <img src="${currentPreview.image.data}" class="preview-img">
        <span>${currentPreview.image.name}</span>
        <button class="remove-btn" onclick="removePreview('image')">✕</button>
      </div>`;
  }

  // DOCUMENT
  if (currentPreview.document.file) {
    previewArea.innerHTML += `
      <div class="preview-box">
        📄 ${currentPreview.document.name}
        <button class="remove-btn" onclick="removePreview('document')">✕</button>
      </div>`;
  }

  // AUDIO
  if (currentPreview.audio.file) {
    previewArea.innerHTML += `
      <div class="preview-box">
        🎵 ${currentPreview.audio.name} (${currentPreview.audio.duration}s)
        <button class="remove-btn" onclick="removePreview('audio')">✕</button>
      </div>`;
  }

  previewArea.classList.remove("hidden");
}

function removePreview(type) {
  currentPreview[type] = { file: null, name: null, data: null, size: null, duration: null };
  updatePreviewArea();

  // Hide entire preview area if empty
  if (
    !currentPreview.image.file &&
    !currentPreview.document.file &&
    !currentPreview.audio.file
  ) {
    previewArea.classList.add("hidden");
  }
}

/* =========================================================
     SEND MESSAGE
========================================================= */
async function sendMessage() {
  const message = messageInput.value.trim();

  const hasImage = !!currentPreview.image.file;
  const hasDocument = !!currentPreview.document.file;
  const hasAudio = !!currentPreview.audio.file;

  if (!message && !hasImage && !hasDocument && !hasAudio) return;

  emptyState?.classList.add("hidden");

  // Show bubble attachments
  if (hasImage) addAttachmentBubble("image", currentPreview.image);
  if (hasDocument) addAttachmentBubble("document", currentPreview.document);
  if (hasAudio) addAttachmentBubble("audio", currentPreview.audio);

  // Show user text bubble
  if (message) addChatBubble(message, "user");

  // Select endpoint
  let endpoint = "/api/chat";
  if (hasImage) endpoint = "/api/image";
  else if (hasDocument) endpoint = "/api/document";
  else if (hasAudio) endpoint = "/api/audio";

  let body;
  let isForm = false;

  if (!hasImage && !hasDocument && !hasAudio) {
    body = JSON.stringify({ prompt: message });
  } else {
    isForm = true;
    const fd = new FormData();
    if (hasImage) fd.append("file", currentPreview.image.file);
    if (hasDocument) fd.append("file", currentPreview.document.file);
    if (hasAudio) fd.append("file", currentPreview.audio.file);
    fd.append("prompt", message);
    body = fd;
  }

  addLoadingBubble();

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      body,
      headers: !isForm ? { "Content-Type": "application/json" } : undefined,
    });

    removeLoadingBubble();

    if (!resp.ok) {
      addChatBubble("Terjadi kesalahan pada server.", "bot");
      return;
    }

    const result = await resp.json();
    addChatBubble(result.result || result.text || "Tidak ada output.", "bot");
  } catch (err) {
    removeLoadingBubble();
    addChatBubble("Gagal menghubungi server.", "bot");
  }

  // Reset UI
  currentPreview = {
    image: { file: null, name: null, data: null },
    document: { file: null, name: null, size: null },
    audio: { file: null, name: null, duration: null },
  };

  previewArea.innerHTML = "";
  previewArea.classList.add("hidden");

  messageInput.value = "";
  autoGrow();
}

/* =========================================================
     CHAT BUBBLE HELPERS
========================================================= */
function addChatBubble(message, sender) {
  const wrap = document.createElement("div");
  wrap.className = `chat-bubble ${sender === "user" ? "right" : "left"}`;

  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "user-bubble" : "bot-bubble";

  bubble.innerHTML = sender === "bot" ? formatBotMessage(message) : message;

  wrap.appendChild(bubble);
  chatContainer.appendChild(wrap);

  autoScroll();
}

/* =========================================================
     ATTACHMENT BUBBLE
========================================================= */
function addAttachmentBubble(type, info) {
  const wrap = document.createElement("div");
  wrap.className = "chat-bubble right";

  const bubble = document.createElement("div");
  bubble.className = "user-bubble";

  if (type === "image") {
    bubble.innerHTML = `
      <img src="${info.data}" style="max-width:180px;border-radius:12px;object-fit:cover;" />`;
  } else if (type === "document") {
    bubble.innerHTML = `
      <div class="doc-bubble">📄 <strong>${info.name}</strong></div>`;
  } else if (type === "audio") {
    bubble.innerHTML = `
      <div class="audio-bubble">🎵 <strong>${info.name}</strong> (${info.duration}s)</div>`;
  }

  wrap.appendChild(bubble);
  chatContainer.appendChild(wrap);
  autoScroll();
}

/* =========================================================
     LOADING / TYPING BUBBLE
========================================================= */
function addLoadingBubble() {
  const wrap = document.createElement("div");
  wrap.id = "loadingBubble";
  wrap.className = "chat-bubble left";

  wrap.innerHTML = `
    <div class="bot-bubble">
      <div class="typing-indicator"><div></div><div></div><div></div></div>
    </div>
  `;

  chatContainer.appendChild(wrap);
  autoScroll();
}

function removeLoadingBubble() {
  document.getElementById("loadingBubble")?.remove();
}

/* =========================================================
     FORMAT BOT MESSAGE
========================================================= */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatBotMessage(text) {
  if (!text) return "";
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\n/g, "<br>");
  return s;
}

/* =========================================================
     AUTO SCROLL
========================================================= */
function autoScroll() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}
