"use strict";

const obsidian = require("obsidian");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const VIEW_TYPE = "claude-chat-view";
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 12000;
const DEFAULT_NOTE_CHARS = 12000;
const DEFAULT_WEB_CHARS = 10000;
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const EXTERNAL_CONFIG_FILENAME = "claude-chat.config.json";
const EXTERNAL_CONFIG_EXAMPLE_FILENAME = "claude-chat.config.example.json";
const EXTERNAL_SETTING_KEYS = [
  "models",
  "maxTokens",
  "gitRemote",
];

const DEFAULT_SETTINGS = {
  models: [],
  activeModelLabel: "",
  maxTokens: 16384,
  enableTools: true,
  enableWebSearch: true,
  enableGitTools: true,
  enableImageUpload: true,
  webSearchLimit: 5,
  gitRemote: "origin",
  noteExportFolder: "Claude Chat Notes",
  openGeneratedNotesInRightPane: true,
};

function toText(value) {
  return String(value ?? "").replace(/\r/g, "");
}

function cleanText(value) {
  return toText(value).replace(/\u0000/g, "").trim();
}

function clampInteger(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function truncateText(value, maxChars) {
  const text = toText(value);
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[truncated ${omitted} chars]`;
}

function escapeHtml(text) {
  return toText(text).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] || char;
  });
}

function renderMarkdown(text) {
  const codeBlocks = [];
  let html = escapeHtml(text);

  html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(
      `<pre><code class="language-${lang || "plain"}">${code}</code></pre>`
    );
    return token;
  });

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");

  codeBlocks.forEach((block, index) => {
    html = html.replace(`@@CODEBLOCK_${index}@@`, block);
  });

  return html;
}

async function renderMarkdownInto(app, component, el, markdown, sourcePath = "") {
  const value = toText(markdown);
  el.empty();

  if (obsidian.MarkdownRenderer?.renderMarkdown) {
    await obsidian.MarkdownRenderer.renderMarkdown(
      value,
      el,
      sourcePath,
      component
    );
    return;
  }

  if (obsidian.MarkdownRenderer?.render) {
    await obsidian.MarkdownRenderer.render(app, value, el, sourcePath, component);
    return;
  }

  el.innerHTML = renderMarkdown(value);
}

function decodeHtmlEntities(text) {
  if (typeof document === "undefined") return toText(text);
  const textarea = document.createElement("textarea");
  textarea.innerHTML = toText(text);
  return textarea.value;
}

function htmlToText(html) {
  if (!html) return "";

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
    return cleanText(
      (doc.body?.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
    );
  }

  return cleanText(
    decodeHtmlEntities(String(html))
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
  );
}

function normalizeBaseUrl(baseUrl) {
  return cleanText(baseUrl).replace(/\/+$/, "");
}

function normalizeVaultPath(input, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  let value = toText(input).trim().replace(/\\/g, "/").replace(/^\/+/, "");

  if (!value) {
    if (allowEmpty) return "";
    throw new Error("Path is required.");
  }

  value = obsidian.normalizePath(value);

  if (!value || value === ".") {
    if (allowEmpty) return "";
    throw new Error("Path is required.");
  }

  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) {
    throw new Error("Path must stay inside the vault.");
  }

  if (options.requireMarkdown && !value.toLowerCase().endsWith(".md")) {
    value += ".md";
  }

  return value;
}

function parentFolderOfPath(filePath) {
  const segments = filePath.split("/");
  segments.pop();
  return segments.join("/");
}

function sanitizeFileName(value) {
  return cleanText(value)
    .replace(/[\\/:*?"<>|#[\]^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function stripMarkdownCodeFence(text) {
  const value = toText(text).trim();
  const match = value.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : value;
}

function extractTitleFromMarkdown(markdown) {
  const lines = toText(markdown).split("\n");
  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }
  return "";
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return toText(value);
  }
}

function pickKeys(source, keys) {
  const result = {};
  keys.forEach((key) => {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  });
  return result;
}

function omitKeys(source, keys) {
  const result = { ...source };
  keys.forEach((key) => {
    delete result[key];
  });
  return result;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function guessMediaType(file) {
  const type = cleanText(file?.type || "");
  if (type.startsWith("image/")) return type;

  const name = toText(file?.name).toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  return "";
}

function buildSnippet(text, query, radius = 140) {
  const source = toText(text);
  const needle = cleanText(query).toLowerCase();
  if (!needle) return truncateText(source, radius * 2);

  const lower = source.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) {
    return truncateText(source.replace(/\s+/g, " "), radius * 2);
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + needle.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return `${prefix}${source.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function unwrapDuckDuckGoUrl(rawUrl) {
  const value = toText(rawUrl).trim();
  if (!value) return "";

  try {
    const absolute = value.startsWith("http")
      ? value
      : value.startsWith("//")
        ? `https:${value}`
        : `https://duckduckgo.com${value.startsWith("/") ? "" : "/"}${value}`;
    const parsed = new URL(absolute);
    const redirect = parsed.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : absolute;
  } catch {
    return value;
  }
}

function summarizeToolCall(name, input) {
  const target =
    input?.path ||
    input?.from ||
    input?.to ||
    input?.query ||
    input?.url ||
    input?.message ||
    "";
  return `Using \`${name}\`${target ? `: ${toText(target)}` : ""}`;
}

function summarizeToolResult(name, result, isError) {
  if (isError) {
    const message = result?.error || result?.summary || safeJson(result);
    return `\`${name}\` failed: ${message}`;
  }

  if (result?.summary) {
    return `\`${name}\`: ${result.summary}`;
  }

  return `\`${name}\` completed.`;
}

class ClaudeChatView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.apiMessages = [];
    this.isRunning = false;
    this.abortController = null;
    this.pendingImages = [];
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Claude Chat";
  }

  getIcon() {
    return "message-circle";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("claude-chat-container");

    const toolbar = container.createDiv({ cls: "claude-chat-toolbar" });
    const toolbarMeta = toolbar.createDiv({ cls: "claude-chat-toolbar-meta" });

    const models = this.plugin.settings.models || [];
    const activeModel = this.plugin.getCurrentModel();
    this.modelBtn = toolbarMeta.createEl("button", {
      text: activeModel ? activeModel.label : "No model",
      cls: "claude-chat-model-btn",
    });
    if (models.length <= 1) {
      this.modelBtn.disabled = true;
    }

    if (models.length > 1) {
      let dropdown = null;
      const closeDropdown = () => {
        if (dropdown) {
          dropdown.remove();
          dropdown = null;
        }
      };
      this.modelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (dropdown) {
          closeDropdown();
          return;
        }
        dropdown = document.body.createDiv({ cls: "claude-chat-model-dropdown" });
        const rect = this.modelBtn.getBoundingClientRect();
        dropdown.style.top = rect.bottom + 6 + "px";
        dropdown.style.left = rect.left + "px";
        models.forEach((m) => {
          const item = dropdown.createDiv({
            cls: "claude-chat-model-dropdown-item",
          });
          const isActive = m.label === this.plugin.getCurrentModel()?.label;
          if (isActive) item.addClass("is-active");
          item.createSpan({ text: isActive ? "✓ " + m.label : m.label });
          item.addEventListener("click", async (e) => {
            e.stopPropagation();
            await this.plugin.setActiveModel(m.label);
            this.modelBtn.textContent = m.label;
            closeDropdown();
          });
        });
        document.addEventListener("click", closeDropdown, { once: true });
      });
    }

    toolbarMeta.createSpan({
      cls: "claude-chat-toolbar-status",
      text: this.getModeSummary(),
    });

    const toolbarActions = toolbar.createDiv({
      cls: "claude-chat-toolbar-actions",
    });
    this.summarizeBtn = toolbarActions.createEl("button", {
      text: "整理成笔记",
      cls: "claude-chat-toolbar-primary",
    });
    this.summarizeBtn.addEventListener("click", () =>
      this.summarizeConversationToNote()
    );

    this.newChatBtn = toolbarActions.createEl("button", { text: "New Chat" });
    this.newChatBtn.addEventListener("click", () => this.resetConversation());

    this.messagesEl = container.createDiv({ cls: "claude-chat-messages" });
    this.emptyStateEl = this.messagesEl.createDiv({ cls: "claude-chat-empty" });
    this.emptyStateEl.createEl("h3", { text: "Claude Vault Assistant" });
    this.emptyStateEl.createEl("p", {
      text:
        "Ask it to summarize notes, reorganize markdown, search the web, inspect images, or sync changes to GitHub.",
    });
    this.emptyStateEl.createEl("p", {
      text:
        "Examples: “整理当前笔记”, “搜索最新资料并写入当前笔记”, “分析这张截图”, “提交并推送今天的修改”。",
    });

    const inputArea = container.createDiv({ cls: "claude-chat-input-area" });
    this.pendingImagesEl = inputArea.createDiv({
      cls: "claude-chat-pending-images",
    });

    const composerRow = inputArea.createDiv({ cls: "claude-chat-composer" });
    this.imageBtn = composerRow.createEl("button", {
      text: "Image",
      cls: "claude-chat-attach-btn",
      attr: {
        type: "button",
        "aria-label": "Attach images",
      },
    });

    this.fileInputEl = composerRow.createEl("input", {
      attr: {
        type: "file",
        accept: "image/*,.pdf",
        multiple: "multiple",
      },
    });
    this.fileInputEl.style.display = "none";

    this.inputEl = composerRow.createEl("textarea", {
      attr: {
        placeholder:
          "Ask Claude to read, write, organize notes, search the web, inspect images, or push to GitHub...",
        rows: 1,
      },
    });
    this.sendBtn = composerRow.createEl("button", {
      text: "Send",
      cls: "claude-chat-send-btn",
    });

    if (!this.plugin.settings.enableImageUpload) {
      this.imageBtn.style.display = "none";
    }

    this.imageBtn.addEventListener("click", () => this.fileInputEl.click());
    this.fileInputEl.addEventListener("change", async () => {
      await this.addPendingImages(this.fileInputEl.files);
      this.fileInputEl.value = "";
    });

    this.inputEl.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height =
        Math.min(this.inputEl.scrollHeight, 200) + "px";
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    });

    this.inputEl.addEventListener("paste", async (event) => {
      if (!this.plugin.settings.enableImageUpload) return;
      const items = Array.from(event.clipboardData?.items || []);
      const files = items
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);

      if (!files.length) return;

      event.preventDefault();
      await this.addPendingImages(files);
    });

    this.sendBtn.addEventListener("click", () => this.sendMessage());
    this.renderPendingImages();
    this.updateEmptyState();
    this.updateActionButtons();
  }

  getModeSummary() {
    const modes = [];
    if (this.plugin.settings.enableTools) modes.push("vault");
    if (this.plugin.settings.enableWebSearch) modes.push("web");
    if (this.plugin.settings.enableGitTools) modes.push("git");
    if (this.plugin.settings.enableImageUpload) modes.push("image");
    return modes.length ? modes.join(" · ") : "chat only";
  }

  resetConversation() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.apiMessages = [];
    this.pendingImages = [];
    this.messagesEl.querySelectorAll(".claude-chat-msg").forEach((el) => el.remove());
    this.renderPendingImages();
    this.updateEmptyState();
    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.inputEl.focus();
    this.updateActionButtons();
  }

  async sendMessage() {
    const text = cleanText(this.inputEl.value);
    const attachments = this.pendingImages.map((item) => ({ ...item }));
    if ((!text && !attachments.length) || this.isRunning) return;

    if (!this.plugin.getCurrentModel()) {
      this.appendMessageEl(
        "error",
        "No model configured. Add models to claude-chat.config.json first."
      );
      return;
    }

    const previousLength = this.apiMessages.length;
    const userContent = [];

    attachments.forEach((image) => {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType,
          data: image.data,
        },
      });
    });

    if (text) {
      userContent.push({ type: "text", text });
    } else if (attachments.length) {
      userContent.push({
        type: "text",
        text: "Please analyze the attached image and answer the user's implied request.",
      });
    }

    this.apiMessages.push({
      role: "user",
      content: userContent,
    });

    this.appendMessageEl("user", { text, attachments });
    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    this.pendingImages = [];
    this.renderPendingImages();
    this.setBusyState(true, "chat");

    const thinkingMessage = this.appendMessageEl("thinking", "Working...");
    const assistantMessage = this.appendMessageEl("assistant", "");
    let thinkingText = "";
    let assistantText = "";

    try {
      this.abortController = new AbortController();

      await this.plugin.runAgentConversation(
        this.apiMessages,
        {
          onThinking: (chunk) => {
            if (!chunk) return;
            thinkingText = thinkingText
              ? `${thinkingText}\n\n${chunk}`
              : chunk;
            thinkingMessage.container.style.display = "";
            void this.renderMessageContent(
              thinkingMessage,
              "thinking",
              thinkingText
            );
            this.scrollToBottom();
          },
          onText: (chunk) => {
            if (!chunk) return;
            assistantText = assistantText
              ? `${assistantText}\n\n${chunk}`
              : chunk;
            void this.renderMessageContent(
              assistantMessage,
              "assistant",
              assistantText
            );
            this.scrollToBottom();
          },
          onToolStart: (name, input) => {
            this.appendMessageEl("tool", summarizeToolCall(name, input));
          },
          onToolEnd: (name, result, isError) => {
            this.appendMessageEl(
              isError ? "error" : "tool",
              summarizeToolResult(name, result, isError)
            );
          },
        },
        this.abortController.signal
      );

      if (!thinkingText) {
        thinkingMessage.container.remove();
      }
      if (!assistantText) {
        assistantMessage.container.remove();
      }
    } catch (error) {
      this.apiMessages = this.apiMessages.slice(0, previousLength);
      if (thinkingMessage.container.isConnected) {
        thinkingMessage.container.remove();
      }
      if (assistantMessage.container.isConnected) {
        assistantMessage.container.remove();
      }
      if (error.name !== "AbortError") {
        this.appendMessageEl("error", error.message || String(error));
      }
    } finally {
      this.abortController = null;
      this.setBusyState(false);
      this.inputEl.focus();
      this.scrollToBottom();
      this.updateEmptyState();
    }
  }

  canSummarizeConversation() {
    return this.apiMessages.some((message) => {
      if (!Array.isArray(message?.content)) return false;
      return message.content.some((block) => {
        if (block?.type === "text") return Boolean(cleanText(block.text));
        if (block?.type === "image") return true;
        return false;
      });
    });
  }

  setBusyState(isBusy, mode = "chat") {
    this.isRunning = isBusy;

    if (this.sendBtn) {
      this.sendBtn.disabled = isBusy;
      this.sendBtn.textContent = isBusy && mode === "chat" ? "Working" : "Send";
    }

    if (this.imageBtn) {
      this.imageBtn.disabled = isBusy;
    }

    if (this.newChatBtn) {
      this.newChatBtn.disabled = isBusy;
    }

    this.updateActionButtons(mode);
  }

  updateActionButtons(mode = "idle") {
    if (!this.summarizeBtn) return;

    const missingModel = !this.plugin.getCurrentModel();
    const disabled = this.isRunning || missingModel || !this.canSummarizeConversation();
    this.summarizeBtn.disabled = disabled;
    this.summarizeBtn.textContent =
      this.isRunning && mode === "note" ? "整理中" : "整理成笔记";
    this.summarizeBtn.title = missingModel
      ? "No model configured. Add models to claude-chat.config.json first."
      : "";
  }

  getConversationSuccessMessage(path) {
    const noteLink = `[[${path.replace(/\.md$/i, "")}]]`;
    return `已整理成笔记并保存：${noteLink}`;
  }

  async summarizeConversationToNote() {
    if (this.isRunning || !this.canSummarizeConversation()) return;

    if (!this.plugin.getCurrentModel()) {
      this.appendMessageEl(
        "error",
        "No model configured. Add models to claude-chat.config.json first."
      );
      return;
    }

    new SaveNoteModal(
      this.plugin.app,
      this.plugin.settings.noteExportFolder,
      async ({ title, folder }) => {
        this.abortController = new AbortController();
        this.setBusyState(true, "note");
        const thinkingMessage = this.appendMessageEl(
          "thinking",
          "正在把这段多轮对话整理成一份结构化笔记..."
        );

        try {
          const note = await this.plugin.generateConversationNote(
            this.apiMessages,
            this.abortController.signal,
            { sourceLeaf: this.leaf, customTitle: title, customFolder: folder }
          );

          if (thinkingMessage.container.isConnected) {
            thinkingMessage.container.remove();
          }

          this.appendMessageEl("tool", this.getConversationSuccessMessage(note.path));
          new obsidian.Notice(`已生成笔记：${note.path}`);
        } catch (error) {
          if (thinkingMessage.container.isConnected) {
            thinkingMessage.container.remove();
          }
          if (error.name !== "AbortError") {
            this.appendMessageEl("error", error.message || String(error));
          }
        } finally {
          this.abortController = null;
          this.setBusyState(false);
          this.scrollToBottom();
        }
      }
    ).open();
  }

  getMessageLabel(type) {
    const labels = {
      thinking: "Planning",
      tool: "Tools",
      error: "Error",
    };
    return labels[type] || null;
  }

  createMessageEl(type) {
    const container = this.messagesEl.createDiv({
      cls: `claude-chat-msg claude-chat-msg-${type}`,
    });
    const label = this.getMessageLabel(type);
    if (label) {
      container.createDiv({ cls: "claude-chat-msg-meta", text: label });
    }
    const body = container.createDiv({ cls: "claude-chat-msg-body" });

    if (type === "thinking") {
      container.style.display = "none";
    }

    this.updateEmptyState();
    return { container, body };
  }

  appendMessageEl(type, content) {
    const message = this.createMessageEl(type);
    void this.renderMessageContent(message, type, content);
    this.scrollToBottom();
    return message;
  }

  async renderMessageContent(message, type, content) {
    const { body } = message;
    body.empty();

    if (type === "user") {
      const text = cleanText(content?.text || "");
      const attachments = Array.isArray(content?.attachments)
        ? content.attachments
        : [];

      if (text) {
        body.createDiv({
          cls: "claude-chat-user-text",
          text,
        });
      }

      if (attachments.length) {
        this.renderImageGallery(body, attachments, false);
      }

      return;
    }

    const markdown = toText(content);
    if (!markdown) return;

    const sourcePath = this.plugin.app.workspace.getActiveFile()?.path || "";

    try {
      await renderMarkdownInto(
        this.plugin.app,
        this,
        body,
        markdown,
        sourcePath
      );
    } catch {
      body.innerHTML = renderMarkdown(markdown);
    }
  }

  renderImageGallery(container, attachments, removable) {
    const gallery = container.createDiv({
      cls: removable
        ? "claude-chat-attachment-list is-pending"
        : "claude-chat-attachment-list",
    });

    attachments.forEach((attachment, index) => {
      const card = gallery.createDiv({ cls: "claude-chat-attachment-card" });
      if (attachment.type === "pdf") {
        const icon = card.createDiv({ cls: "claude-chat-attachment-thumb claude-chat-attachment-pdf-icon" });
        icon.setText("📄");
      } else {
        const preview = card.createEl("img", {
          cls: "claude-chat-attachment-thumb",
          attr: {
            src: attachment.previewUrl,
            alt: attachment.name,
            loading: "lazy",
          },
        });
        preview.addEventListener("error", () => {
          preview.style.display = "none";
        });
      }

      const info = card.createDiv({ cls: "claude-chat-attachment-info" });
      info.createDiv({
        cls: "claude-chat-attachment-name",
        text: attachment.name,
      });
      info.createDiv({
        cls: "claude-chat-attachment-meta",
        text: `${attachment.mediaType} · ${formatBytes(attachment.size)}`,
      });

      if (removable) {
        const removeBtn = card.createEl("button", {
          text: "Remove",
          cls: "claude-chat-attachment-remove",
          attr: { type: "button" },
        });
        removeBtn.addEventListener("click", () => {
          this.pendingImages.splice(index, 1);
          this.renderPendingImages();
        });
      }
    });
  }

  renderPendingImages() {
    this.pendingImagesEl.empty();

    if (!this.pendingImages.length) {
      this.pendingImagesEl.style.display = "none";
      return;
    }

    this.pendingImagesEl.style.display = "block";
    this.renderImageGallery(this.pendingImagesEl, this.pendingImages, true);
  }

  async fileToImageAttachment(file) {
    const mediaType = guessMediaType(file);
    if (!mediaType) {
      throw new Error(`Unsupported image type: ${file.name || "unknown file"}`);
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `${file.name} is too large. Keep images under ${formatBytes(MAX_IMAGE_BYTES)}.`
      );
    }

    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = toText(reader.result);
        const base64 = result.includes(",") ? result.split(",").pop() : result;
        resolve(base64 || "");
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsDataURL(file);
    });

    return {
      name: file.name || "image",
      size: file.size || 0,
      mediaType,
      data,
      previewUrl: `data:${mediaType};base64,${data}`,
    };
  }

  async fileToPdfAttachment(file) {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(
        `${file.name} is too large. Keep PDFs under ${formatBytes(MAX_PDF_BYTES)}.`
      );
    }

    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = toText(reader.result);
        const base64 = result.includes(",") ? result.split(",").pop() : result;
        resolve(base64 || "");
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
      reader.readAsDataURL(file);
    });

    return {
      type: "pdf",
      name: file.name || "document.pdf",
      size: file.size || 0,
      mediaType: "application/pdf",
      data,
    };
  }

  async addPendingImages(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    for (const file of files) {
      if (this.pendingImages.length >= MAX_IMAGE_ATTACHMENTS) {
        new obsidian.Notice(
          `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images at a time.`
        );
        break;
      }

      try {
        const isPdf =
          file.type === "application/pdf" ||
          (file.name || "").toLowerCase().endsWith(".pdf");
        const attachment = isPdf
          ? await this.fileToPdfAttachment(file)
          : await this.fileToImageAttachment(file);
        this.pendingImages.push(attachment);
      } catch (error) {
        new obsidian.Notice(error.message || String(error));
      }
    }

    this.renderPendingImages();
    this.scrollToBottom();
  }

  updateEmptyState() {
    if (!this.emptyStateEl) return;
    const hasMessages = Boolean(this.messagesEl?.querySelector(".claude-chat-msg"));
    this.emptyStateEl.style.display = hasMessages ? "none" : "block";
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  async onClose() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

class SaveNoteModal extends obsidian.Modal {
  constructor(app, defaultFolder, onSubmit) {
    super(app);
    this.defaultFolder = defaultFolder || "Claude Chat Notes";
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "整理成笔记" });

    let title = "";
    let folder = this.defaultFolder;

    new obsidian.Setting(contentEl)
      .setName("笔记标题")
      .setDesc("文件名（不含 .md）")
      .addText((text) => {
        text.setPlaceholder("我的学习笔记").onChange((v) => {
          title = v.trim();
        });
        setTimeout(() => text.inputEl.focus(), 50);
      });

    new obsidian.Setting(contentEl)
      .setName("保存到目录")
      .setDesc("Vault 内的文件夹路径，不存在时自动创建")
      .addText((text) =>
        text.setValue(folder).onChange((v) => {
          folder = v.trim() || this.defaultFolder;
        })
      );

    new obsidian.Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("开始整理")
          .setCta()
          .onClick(() => {
            if (!title) {
              new obsidian.Notice("请输入笔记标题。");
              return;
            }
            this.close();
            this.onSubmit({ title, folder });
          })
      )
      .addButton((btn) =>
        btn.setButtonText("取消").onClick(() => this.close())
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ClaudeChatSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Claude Chat Settings" });
    containerEl.createEl("p", {
      text:
        "Models and credentials are configured in claude-chat.config.json next to this plugin. Switch models using the dropdown in the chat toolbar.",
    });

    new obsidian.Setting(containerEl)
      .setName("Max Tokens")
      .setDesc("Saved to claude-chat.config.json")
      .addText((text) =>
        text
          .setPlaceholder("16384")
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (value) => {
            this.plugin.settings.maxTokens = clampInteger(
              value,
              256,
              32768,
              this.plugin.settings.maxTokens
            );
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Enable Vault Tools")
      .setDesc("Allow Claude to search, read, create, and edit markdown notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTools)
          .onChange(async (value) => {
            this.plugin.settings.enableTools = value;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Enable Web Search")
      .setDesc("Allow Claude to search the web and fetch page contents")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableWebSearch)
          .onChange(async (value) => {
            this.plugin.settings.enableWebSearch = value;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Enable Image Upload")
      .setDesc("Allow attaching images for Claude to analyze")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableImageUpload)
          .onChange(async (value) => {
            this.plugin.settings.enableImageUpload = value;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Web Search Result Limit")
      .setDesc("Maximum web search results returned per tool call")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.webSearchLimit))
          .onChange(async (value) => {
            this.plugin.settings.webSearchLimit = clampInteger(
              value,
              1,
              10,
              this.plugin.settings.webSearchLimit
            );
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Enable Git Tools")
      .setDesc("Allow Claude to run git status and commit/push the vault repo")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableGitTools)
          .onChange(async (value) => {
            this.plugin.settings.enableGitTools = value;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Git Remote")
      .setDesc("Saved to claude-chat.config.json")
      .addText((text) =>
        text
          .setPlaceholder("origin")
          .setValue(this.plugin.settings.gitRemote)
          .onChange(async (value) => {
            this.plugin.settings.gitRemote = value.trim() || "origin";
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Generated Notes Folder")
      .setDesc("Folder used by the 整理成笔记 action")
      .addText((text) =>
        text
          .setPlaceholder("Claude Chat Notes")
          .setValue(this.plugin.settings.noteExportFolder)
          .onChange(async (value) => {
            this.plugin.settings.noteExportFolder =
              normalizeVaultPath(value || DEFAULT_SETTINGS.noteExportFolder, {
                allowEmpty: true,
              }) || DEFAULT_SETTINGS.noteExportFolder;
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Open generated note in right pane")
      .setDesc("After整理成笔记, open the new note on the right side")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openGeneratedNotesInRightPane)
          .onChange(async (value) => {
            this.plugin.settings.openGeneratedNotesInRightPane = value !== false;
            await this.plugin.saveSettings();
          })
      );
  }
}

class ClaudeChatPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new ClaudeChatView(leaf, this));

    this.addRibbonIcon("message-circle", "Open Claude Chat", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-claude-chat",
      name: "Open Claude Chat",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new ClaudeChatSettingTab(this.app, this));
  }

  getPluginDirectory() {
    const vaultRoot = this.app.vault?.adapter?.basePath || "";
    if (!vaultRoot) {
      throw new Error("Cannot resolve the local plugin directory for this vault.");
    }
    return path.join(vaultRoot, this.app.vault.configDir, "plugins", this.manifest.id);
  }

  getExternalConfigPath() {
    return path.join(this.getPluginDirectory(), EXTERNAL_CONFIG_FILENAME);
  }

  getExternalConfigExamplePath() {
    return path.join(
      this.getPluginDirectory(),
      EXTERNAL_CONFIG_EXAMPLE_FILENAME
    );
  }

  getExternalConfigTemplate() {
    return {
      models: [],
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      gitRemote: DEFAULT_SETTINGS.gitRemote,
    };
  }

  normalizeSettings(settings) {
    const models = Array.isArray(settings.models)
      ? settings.models.filter(
          (m) =>
            m &&
            typeof m === "object" &&
            cleanText(m.label) &&
            cleanText(m.model) &&
            cleanText(m.baseUrl) &&
            cleanText(m.apiKey)
        )
      : [];

    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      models,
      activeModelLabel: cleanText(settings.activeModelLabel),
      maxTokens: clampInteger(
        settings.maxTokens,
        256,
        32768,
        DEFAULT_SETTINGS.maxTokens
      ),
      enableTools: settings.enableTools !== false,
      enableWebSearch: settings.enableWebSearch !== false,
      enableGitTools: settings.enableGitTools !== false,
      enableImageUpload: settings.enableImageUpload !== false,
      webSearchLimit: clampInteger(
        settings.webSearchLimit,
        1,
        10,
        DEFAULT_SETTINGS.webSearchLimit
      ),
      gitRemote: cleanText(settings.gitRemote) || DEFAULT_SETTINGS.gitRemote,
      noteExportFolder:
        normalizeVaultPath(
          settings.noteExportFolder || DEFAULT_SETTINGS.noteExportFolder,
          { allowEmpty: true }
        ) || DEFAULT_SETTINGS.noteExportFolder,
      openGeneratedNotesInRightPane:
        settings.openGeneratedNotesInRightPane !== false,
    };
  }

  async ensureConfigTemplateFiles() {
    const examplePath = this.getExternalConfigExamplePath();
    const configPath = this.getExternalConfigPath();
    const templateJson = `${safeJson(this.getExternalConfigTemplate())}\n`;

    try {
      await fs.access(examplePath);
    } catch {
      await fs.writeFile(examplePath, templateJson, "utf8");
    }

    try {
      await fs.access(configPath);
    } catch {
      await fs.writeFile(configPath, templateJson, "utf8");
      new obsidian.Notice(
        `Created ${EXTERNAL_CONFIG_FILENAME}. Fill it in with your own API settings.`
      );
    }
  }

  async loadExternalConfig() {
    let raw;

    try {
      raw = await fs.readFile(this.getExternalConfigPath(), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      }
      throw error;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `${EXTERNAL_CONFIG_FILENAME} is not valid JSON: ${error.message}`
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${EXTERNAL_CONFIG_FILENAME} must be a JSON object.`);
    }

    return this.normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...pickKeys(parsed, EXTERNAL_SETTING_KEYS),
    });
  }

  async writeExternalConfig(settings) {
    const normalized = this.normalizeSettings(settings);
    const payload = pickKeys(normalized, EXTERNAL_SETTING_KEYS);
    await fs.writeFile(
      this.getExternalConfigPath(),
      `${safeJson(payload)}\n`,
      "utf8"
    );
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  getCurrentModel() {
    const models = this.settings.models || [];
    return (
      models.find((m) => m.label === this.settings.activeModelLabel) ||
      models[0] ||
      null
    );
  }

  async setActiveModel(label) {
    this.settings.activeModelLabel = label;
    await this.saveData(omitKeys(this.settings, EXTERNAL_SETTING_KEYS));
  }

  async loadSettings() {
    const savedSettings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    await this.ensureConfigTemplateFiles();

    let externalSettings = {};
    try {
      externalSettings = await this.loadExternalConfig();
    } catch (error) {
      console.error(error);
      new obsidian.Notice(error.message || String(error));
    }

    this.settings = this.normalizeSettings({
      ...savedSettings,
      ...pickKeys(externalSettings, EXTERNAL_SETTING_KEYS),
    });
  }

  async saveSettings() {
    this.settings = this.normalizeSettings(this.settings);
    await this.saveData(omitKeys(this.settings, EXTERNAL_SETTING_KEYS));
    await this.writeExternalConfig(this.settings);
  }

  buildSystemPrompt() {
    const activeFile = this.app.workspace.getActiveFile();
    const today = new Date().toISOString().slice(0, 10);

    return [
      "You are an Obsidian vault assistant.",
      `Today is ${today}.`,
      activeFile
        ? `The current active note is "${activeFile.path}".`
        : "There is no active markdown note right now.",
      "When the user asks about notes, use the available tools instead of saying you cannot access local files.",
      "Read the current note or inspect relevant notes before making broad edits.",
      "Prefer focused edits with replace_in_note when possible; otherwise rewrite the full note cleanly.",
      "Preserve frontmatter and existing structure unless the user asks to reorganize it.",
      "If the user attaches images, inspect them directly and combine that with vault or web context when useful.",
      "Use web_search or fetch_url when the task needs external or current information.",
      "Only use git_commit_and_push when the user explicitly asks to commit, sync, publish, or push changes.",
      "After using tools, explain what changed and mention note paths that were touched.",
    ].join(" ");
  }

  getToolDefinitions() {
    const tools = [];

    if (this.settings.enableTools) {
      tools.push(
        {
          name: "get_active_note",
          description:
            "Read the currently active markdown note, including the selected text if there is one.",
          input_schema: {
            type: "object",
            properties: {
              include_content: {
                type: "boolean",
                description: "Include note content. Defaults to true.",
              },
              max_chars: {
                type: "integer",
                description: "Maximum number of content characters to return.",
              },
            },
            additionalProperties: false,
          },
        },
        {
          name: "list_notes",
          description:
            "List markdown notes in the vault, optionally scoped to a folder.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Optional folder path inside the vault.",
              },
              recursive: {
                type: "boolean",
                description: "Whether to include nested folders. Defaults to true.",
              },
              limit: {
                type: "integer",
                description: "Maximum number of notes to return.",
              },
            },
            additionalProperties: false,
          },
        },
        {
          name: "search_notes",
          description:
            "Search markdown notes by file path and content, returning snippets.",
          input_schema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to match against notes.",
              },
              path: {
                type: "string",
                description: "Optional folder path inside the vault.",
              },
              limit: {
                type: "integer",
                description: "Maximum number of matches to return.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
        {
          name: "read_note",
          description: "Read a markdown note from the vault.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the markdown note.",
              },
              max_chars: {
                type: "integer",
                description: "Maximum number of characters to return.",
              },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
        {
          name: "create_note",
          description:
            "Create a markdown note. Creates parent folders if needed.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path for the markdown note.",
              },
              content: {
                type: "string",
                description: "Full markdown content for the new note.",
              },
              overwrite: {
                type: "boolean",
                description: "Overwrite the note if it already exists.",
              },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        {
          name: "replace_note",
          description:
            "Replace the full contents of a markdown note, optionally creating it.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the markdown note.",
              },
              content: {
                type: "string",
                description: "New full markdown content.",
              },
              create_if_missing: {
                type: "boolean",
                description: "Create the note if it does not exist.",
              },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        {
          name: "append_note",
          description:
            "Append content to the end of a markdown note, optionally creating it.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the markdown note.",
              },
              content: {
                type: "string",
                description: "Content to append.",
              },
              create_if_missing: {
                type: "boolean",
                description: "Create the note if it does not exist.",
              },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        {
          name: "replace_in_note",
          description:
            "Replace an exact string inside a markdown note.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the markdown note.",
              },
              find: {
                type: "string",
                description: "Exact text to find.",
              },
              replace: {
                type: "string",
                description: "Replacement text.",
              },
              replace_all: {
                type: "boolean",
                description: "Replace all matches instead of just the first.",
              },
            },
            required: ["path", "find", "replace"],
            additionalProperties: false,
          },
        },
        {
          name: "move_note",
          description: "Move or rename a markdown note inside the vault.",
          input_schema: {
            type: "object",
            properties: {
              from: {
                type: "string",
                description: "Existing note path.",
              },
              to: {
                type: "string",
                description: "New note path.",
              },
            },
            required: ["from", "to"],
            additionalProperties: false,
          },
        },
        {
          name: "open_note",
          description: "Open a markdown note in Obsidian.",
          input_schema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the markdown note.",
              },
            },
            required: ["path"],
            additionalProperties: false,
          },
        }
      );
    }

    if (this.settings.enableWebSearch) {
      tools.push(
        {
          name: "web_search",
          description:
            "Search the public web and return a few relevant result links.",
          input_schema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query.",
              },
              limit: {
                type: "integer",
                description: "Maximum number of results to return.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
        {
          name: "fetch_url",
          description:
            "Fetch a public web page or JSON endpoint and return cleaned text.",
          input_schema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "HTTP or HTTPS URL.",
              },
              max_chars: {
                type: "integer",
                description: "Maximum number of characters to return.",
              },
            },
            required: ["url"],
            additionalProperties: false,
          },
        }
      );
    }

    if (this.settings.enableGitTools) {
      tools.push(
        {
          name: "git_status",
          description:
            "Get git status for the current vault repository.",
          input_schema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "git_commit_and_push",
          description:
            "Stage files, create a commit, and push the current branch to the configured remote.",
          input_schema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Commit message.",
              },
              paths: {
                type: "array",
                description:
                  "Optional markdown file paths to stage. Omit to stage all changes in the vault repository.",
                items: {
                  type: "string",
                },
              },
            },
            required: ["message"],
            additionalProperties: false,
          },
        }
      );
    }

    return tools;
  }

  async createMessage(messages, signal, options = {}) {
    const activeModel = this.getCurrentModel();
    if (!activeModel) {
      throw new Error("No models configured in claude-chat.config.json.");
    }
    const baseUrl = normalizeBaseUrl(activeModel.baseUrl);
    if (!baseUrl) {
      throw new Error("Base URL is not configured for the active model.");
    }

    const body = {
      model: options.model || activeModel.model,
      max_tokens: clampInteger(
        options.maxTokens,
        256,
        32768,
        this.settings.maxTokens
      ),
      system: options.systemPrompt || this.buildSystemPrompt(),
      messages,
    };

    const tools = Array.isArray(options.tools)
      ? options.tools
      : this.getToolDefinitions();
    if (tools.length) {
      body.tools = tools;
    }

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": activeModel.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.content)) {
      throw new Error("Unexpected API response: missing content blocks.");
    }

    return data;
  }

  buildConversationTranscript(messages) {
    const transcript = [];

    messages.forEach((message) => {
      if (!Array.isArray(message?.content)) return;

      if (message.role === "user") {
        const blocks = [];
        message.content.forEach((block) => {
          if (block?.type === "text" && cleanText(block.text)) {
            blocks.push(cleanText(block.text));
          } else if (block?.type === "image") {
            blocks.push("[User attached an image]");
          }
        });

        if (blocks.length) {
          transcript.push(`User:\n${blocks.join("\n")}`);
        }
      }

      if (message.role === "assistant") {
        const blocks = message.content
          .filter((block) => block?.type === "text" && cleanText(block.text))
          .map((block) => cleanText(block.text));

        if (blocks.length) {
          transcript.push(`Assistant:\n${blocks.join("\n\n")}`);
        }
      }
    });

    return transcript.join("\n\n---\n\n").trim();
  }

  buildConversationNotePrompt(transcript) {
    const activeFile = this.app.workspace.getActiveFile();
    const activeHint = activeFile
      ? `Current Obsidian context note: ${activeFile.path}`
      : "There is no active note.";

    return [
      "Please turn the following completed learning conversation into a polished Obsidian note.",
      activeHint,
      "",
      "Requirements:",
      "- Output Markdown only. Do not wrap the answer in code fences.",
      "- Start with exactly one H1 title.",
      "- Write in the main language used in the conversation.",
      "- Organize the note so it is easy to review later in Obsidian.",
      "- Include: concise summary, structured key points, explanations, and examples when useful.",
      "- Use bullets, tables, callouts, and short sections when they improve readability.",
      "- If the topic contains a process, workflow, comparison, hierarchy, or decision path, include a Mermaid diagram using valid Obsidian Mermaid syntax.",
      "- Do not mention that this note was generated from a chat.",
      "",
      "Conversation transcript:",
      transcript,
    ].join("\n");
  }

  buildConversationNoteSystemPrompt() {
    return [
      "You are an expert Obsidian note editor.",
      "Your job is to transform finished multi-turn conversations into polished, well-structured study notes.",
      "Prefer clean headings, crisp phrasing, and information density without being messy.",
      "When a diagram would genuinely help, emit a valid mermaid code block that Obsidian can render.",
      "Return Markdown only.",
    ].join(" ");
  }

  getAvailableNotePath(folder, baseName) {
    const normalizedFolder = normalizeVaultPath(folder || "", { allowEmpty: true });
    const safeBase = sanitizeFileName(baseName) || "Claude Chat Note";
    let candidate = normalizedFolder
      ? `${normalizedFolder}/${safeBase}.md`
      : `${safeBase}.md`;
    let index = 2;

    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizedFolder
        ? `${normalizedFolder}/${safeBase} ${index}.md`
        : `${safeBase} ${index}.md`;
      index += 1;
    }

    return candidate;
  }

  async openGeneratedNote(path, sourceLeaf) {
    const file = this.getMarkdownFile(path);
    let leaf = null;

    if (this.settings.openGeneratedNotesInRightPane) {
      try {
        if (
          sourceLeaf &&
          typeof this.app.workspace.createLeafBySplit === "function"
        ) {
          leaf = this.app.workspace.createLeafBySplit(
            sourceLeaf,
            "vertical",
            false
          );
        }
      } catch {
        leaf = null;
      }
    }

    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
    }

    await leaf.openFile(file);
  }

  async generateConversationNote(messages, signal, options = {}) {
    const transcript = this.buildConversationTranscript(messages);
    if (!transcript) {
      throw new Error("There is no conversation content to organize yet.");
    }

    const response = await this.createMessage(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: this.buildConversationNotePrompt(transcript),
            },
          ],
        },
      ],
      signal,
      {
        systemPrompt: this.buildConversationNoteSystemPrompt(),
        tools: [],
        maxTokens: Math.min(24000, this.settings.maxTokens),
      }
    );

    const markdown = stripMarkdownCodeFence(
      response.content
        .filter((block) => block.type === "text" && cleanText(block.text))
        .map((block) => block.text)
        .join("\n\n")
    );

    if (!markdown) {
      throw new Error("The model did not return note content.");
    }

    const title =
      options.customTitle ||
      extractTitleFromMarkdown(markdown) ||
      `Claude Chat Note ${new Date().toISOString().slice(0, 10)}`;
    const folder =
      options.customFolder != null
        ? options.customFolder
        : this.settings.noteExportFolder;
    const datedBaseName = options.customTitle
      ? sanitizeFileName(options.customTitle)
      : `${new Date().toISOString().slice(0, 10)} ${title}`;
    const notePath = this.getAvailableNotePath(folder, datedBaseName);

    await this.ensureFolderForFile(notePath);
    await this.app.vault.create(notePath, `${markdown.trim()}\n`);
    await this.openGeneratedNote(notePath, options.sourceLeaf);

    return {
      ok: true,
      path: notePath,
      title,
      markdown,
      summary: `Generated note ${notePath}.`,
    };
  }

  async runAgentConversation(messages, handlers = {}, signal) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.createMessage(messages, signal);
      const assistantContent = response.content;

      messages.push({
        role: "assistant",
        content: assistantContent,
      });

      assistantContent.forEach((block) => {
        if (block.type === "thinking" && block.thinking) {
          handlers.onThinking?.(block.thinking);
        }
        if (block.type === "text" && block.text) {
          handlers.onText?.(block.text);
        }
      });

      const toolUses = assistantContent.filter(
        (block) => block.type === "tool_use"
      );

      if (!toolUses.length) {
        return response;
      }

      const toolResults = [];

      for (const toolUse of toolUses) {
        handlers.onToolStart?.(toolUse.name, toolUse.input || {});

        let result;
        let isError = false;

        try {
          result = await this.executeTool(toolUse.name, toolUse.input || {});
        } catch (error) {
          isError = true;
          result = {
            ok: false,
            error: error.message || String(error),
            summary: error.message || String(error),
          };
        }

        handlers.onToolEnd?.(toolUse.name, result, isError);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: truncateText(
            typeof result === "string" ? result : safeJson(result),
            MAX_TOOL_RESULT_CHARS
          ),
          is_error: isError,
        });
      }

      messages.push({
        role: "user",
        content: toolResults,
      });
    }

    throw new Error("Tool loop limit reached before Claude finished.");
  }

  getMarkdownFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof obsidian.TFile) || file.extension !== "md") {
      throw new Error(`Markdown note not found: ${path}`);
    }
    return file;
  }

  async ensureFolderForFile(filePath) {
    const folderPath = parentFolderOfPath(filePath);
    if (!folderPath) return;

    const segments = folderPath.split("/").filter(Boolean);
    let current = "";

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);

      if (existing instanceof obsidian.TFolder) {
        continue;
      }

      if (existing) {
        throw new Error(`Cannot create folder "${current}" because a file exists there.`);
      }

      await this.app.vault.createFolder(current);
    }
  }

  async executeTool(name, input) {
    switch (name) {
      case "get_active_note":
        return this.toolGetActiveNote(input);
      case "list_notes":
        return this.toolListNotes(input);
      case "search_notes":
        return this.toolSearchNotes(input);
      case "read_note":
        return this.toolReadNote(input);
      case "create_note":
        return this.toolCreateNote(input);
      case "replace_note":
        return this.toolReplaceNote(input);
      case "append_note":
        return this.toolAppendNote(input);
      case "replace_in_note":
        return this.toolReplaceInNote(input);
      case "move_note":
        return this.toolMoveNote(input);
      case "open_note":
        return this.toolOpenNote(input);
      case "web_search":
        return this.toolWebSearch(input);
      case "fetch_url":
        return this.toolFetchUrl(input);
      case "git_status":
        return this.toolGitStatus();
      case "git_commit_and_push":
        return this.toolGitCommitAndPush(input);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async toolGetActiveNote(input = {}) {
    const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    const file = view?.file;

    if (!file) {
      return {
        ok: true,
        active: false,
        summary: "There is no active markdown note.",
      };
    }

    const maxChars = clampInteger(
      input.max_chars,
      200,
      50000,
      DEFAULT_NOTE_CHARS
    );
    const includeContent = input.include_content !== false;
    const content = includeContent
      ? truncateText(await this.app.vault.cachedRead(file), maxChars)
      : undefined;
    const selection = view.editor?.getSelection?.() || "";

    return {
      ok: true,
      active: true,
      path: file.path,
      summary: `Loaded active note ${file.path}.`,
      content,
      selection: selection || undefined,
      frontmatter:
        this.app.metadataCache.getFileCache(file)?.frontmatter || undefined,
    };
  }

  async toolListNotes(input = {}) {
    const root = normalizeVaultPath(input.path || "", { allowEmpty: true });
    const recursive = input.recursive !== false;
    const limit = clampInteger(input.limit, 1, 200, 50);

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        if (!root) return true;
        if (file.path === root) return true;
        if (!file.path.startsWith(`${root}/`)) return false;
        if (recursive) return true;
        return !file.path.slice(root.length + 1).includes("/");
      })
      .slice(0, limit)
      .map((file) => ({
        path: file.path,
        name: file.basename,
      }));

    return {
      ok: true,
      summary: `Found ${files.length} note${files.length === 1 ? "" : "s"}${
        root ? ` under ${root}` : ""
      }.`,
      notes: files,
    };
  }

  async toolSearchNotes(input = {}) {
    const query = cleanText(input.query);
    if (!query) {
      throw new Error("Search query is required.");
    }

    const root = normalizeVaultPath(input.path || "", { allowEmpty: true });
    const limit = clampInteger(input.limit, 1, 25, 10);
    const matches = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (root && file.path !== root && !file.path.startsWith(`${root}/`)) {
        continue;
      }

      const pathMatch = file.path.toLowerCase().includes(query.toLowerCase());
      const content = await this.app.vault.cachedRead(file);
      const contentMatch = content.toLowerCase().includes(query.toLowerCase());

      if (!pathMatch && !contentMatch) {
        continue;
      }

      matches.push({
        path: file.path,
        match_type:
          pathMatch && contentMatch
            ? "path+content"
            : pathMatch
              ? "path"
              : "content",
        snippet: buildSnippet(content, query),
      });

      if (matches.length >= limit) {
        break;
      }
    }

    return {
      ok: true,
      summary: `Found ${matches.length} matching note${
        matches.length === 1 ? "" : "s"
      } for "${query}".`,
      matches,
    };
  }

  async toolReadNote(input = {}) {
    const path = normalizeVaultPath(input.path, { requireMarkdown: true });
    const maxChars = clampInteger(
      input.max_chars,
      200,
      50000,
      DEFAULT_NOTE_CHARS
    );
    const file = this.getMarkdownFile(path);
    const content = await this.app.vault.cachedRead(file);

    return {
      ok: true,
      path,
      summary: `Read ${path}.`,
      content: truncateText(content, maxChars),
      truncated: content.length > maxChars,
      frontmatter:
        this.app.metadataCache.getFileCache(file)?.frontmatter || undefined,
    };
  }

  async toolCreateNote(input = {}) {
    const path = normalizeVaultPath(input.path, { requireMarkdown: true });
    const content = toText(input.content);
    const overwrite = Boolean(input.overwrite);
    const existing = this.app.vault.getAbstractFileByPath(path);

    await this.ensureFolderForFile(path);

    if (existing) {
      if (!(existing instanceof obsidian.TFile) || existing.extension !== "md") {
        throw new Error(`Cannot overwrite non-markdown path: ${path}`);
      }
      if (!overwrite) {
        throw new Error(`Note already exists: ${path}`);
      }
      await this.app.vault.modify(existing, content);
      return {
        ok: true,
        path,
        summary: `Overwrote ${path}.`,
        bytes: content.length,
      };
    }

    await this.app.vault.create(path, content);
    return {
      ok: true,
      path,
      summary: `Created ${path}.`,
      bytes: content.length,
    };
  }

  async toolReplaceNote(input = {}) {
    const path = normalizeVaultPath(input.path, { requireMarkdown: true });
    const content = toText(input.content);
    const createIfMissing = Boolean(input.create_if_missing);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (!existing) {
      if (!createIfMissing) {
        throw new Error(`Note does not exist: ${path}`);
      }
      await this.ensureFolderForFile(path);
      await this.app.vault.create(path, content);
      return {
        ok: true,
        path,
        summary: `Created ${path} with new content.`,
        bytes: content.length,
      };
    }

    if (!(existing instanceof obsidian.TFile) || existing.extension !== "md") {
      throw new Error(`Markdown note not found: ${path}`);
    }

    await this.app.vault.modify(existing, content);
    return {
      ok: true,
      path,
      summary: `Replaced the full contents of ${path}.`,
      bytes: content.length,
    };
  }

  async toolAppendNote(input = {}) {
    const path = normalizeVaultPath(input.path, { requireMarkdown: true });
    const content = toText(input.content);
    const createIfMissing = Boolean(input.create_if_missing);
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (!existing) {
      if (!createIfMissing) {
        throw new Error(`Note does not exist: ${path}`);
      }
      await this.ensureFolderForFile(path);
      await this.app.vault.create(path, content);
      return {
        ok: true,
        path,
        summary: `Created ${path} and wrote appended content.`,
        bytes_added: content.length,
      };
    }

    if (!(existing instanceof obsidian.TFile) || existing.extension !== "md") {
      throw new Error(`Markdown note not found: ${path}`);
    }

    const current = await this.app.vault.cachedRead(existing);
    const separator =
      current && content && !current.endsWith("\n") && !content.startsWith("\n")
        ? "\n\n"
        : "";
    const nextContent = `${current}${separator}${content}`;

    await this.app.vault.modify(existing, nextContent);
    return {
      ok: true,
      path,
      summary: `Appended content to ${path}.`,
      bytes_added: content.length,
    };
  }

  async toolReplaceInNote(input = {}) {
    const path = normalizeVaultPath(input.path, { requireMarkdown: true });
    const find = toText(input.find);
    const replace = toText(input.replace);
    const replaceAll = Boolean(input.replace_all);

    if (!find) {
      throw new Error("The find string must not be empty.");
    }

    const file = this.getMarkdownFile(path);
    const content = await this.app.vault.cachedRead(file);

    let nextContent = content;
    let count = 0;

    if (replaceAll) {
      count = content.split(find).length - 1;
      if (!count) {
        throw new Error(`No matches found for the provided text in ${path}.`);
      }
      nextContent = content.split(find).join(replace);
    } else {
      const index = content.indexOf(find);
      if (index === -1) {
        throw new Error(`No exact match found in ${path}.`);
      }
      nextContent =
        content.slice(0, index) +
        replace +
        content.slice(index + find.length);
      count = 1;
    }

    await this.app.vault.modify(file, nextContent);
    return {
      ok: true,
      path,
      summary: `Replaced ${count} occurrence${count === 1 ? "" : "s"} in ${path}.`,
      replacements: count,
    };
  }

  async toolMoveNote(input = {}) {
    const from = normalizeVaultPath(input.from, { requireMarkdown: true });
    const to = normalizeVaultPath(input.to, { requireMarkdown: true });
    const file = this.getMarkdownFile(from);
    const existing = this.app.vault.getAbstractFileByPath(to);

    if (existing) {
      throw new Error(`Destination already exists: ${to}`);
    }

    await this.ensureFolderForFile(to);
    await this.app.fileManager.renameFile(file, to);

    return {
      ok: true,
      from,
      to,
      summary: `Moved ${from} to ${to}.`,
    };
  }

  async toolOpenNote(input = {}) {
    const path = normalizeVaultPath(input.path, { requireMarkdown: true });
    const file = this.getMarkdownFile(path);
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);

    return {
      ok: true,
      path,
      summary: `Opened ${path}.`,
    };
  }

  parseDuckDuckGoResults(html, limit) {
    if (typeof DOMParser === "undefined") return [];

    const doc = new DOMParser().parseFromString(String(html), "text/html");
    const items = [];

    const resultNodes = doc.querySelectorAll(".result, .results_links");
    for (const node of resultNodes) {
      const link = node.querySelector("a.result__a, .result__title a");
      if (!link) continue;

      const title = cleanText(link.textContent);
      const url = unwrapDuckDuckGoUrl(link.getAttribute("href"));
      const snippet = cleanText(
        node.querySelector(".result__snippet")?.textContent || ""
      );

      if (!title || !url) continue;
      items.push({ title, url, snippet: snippet || undefined });
      if (items.length >= limit) break;
    }

    return items;
  }

  async toolWebSearch(input = {}) {
    const query = cleanText(input.query);
    if (!query) {
      throw new Error("Search query is required.");
    }

    const limit = clampInteger(
      input.limit,
      1,
      10,
      this.settings.webSearchLimit
    );

    let response;
    try {
      response = await obsidian.requestUrl({
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 Obsidian Claude Chat",
          "accept-language": "en-US,en;q=0.9",
        },
      });
    } catch (error) {
      throw new Error(`Web search request failed: ${error.message || error}`);
    }

    if (response.status >= 400) {
      throw new Error(`Web search failed with status ${response.status}.`);
    }

    const results = this.parseDuckDuckGoResults(response.text || "", limit);

    return {
      ok: true,
      query,
      summary: `Found ${results.length} web result${
        results.length === 1 ? "" : "s"
      } for "${query}".`,
      results,
    };
  }

  async toolFetchUrl(input = {}) {
    const url = cleanText(input.url);
    if (!isHttpUrl(url)) {
      throw new Error("Only http:// and https:// URLs are supported.");
    }

    const maxChars = clampInteger(
      input.max_chars,
      200,
      50000,
      DEFAULT_WEB_CHARS
    );

    let response;
    try {
      response = await obsidian.requestUrl({
        url,
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0 Obsidian Claude Chat",
          "accept-language": "en-US,en;q=0.9",
        },
      });
    } catch (error) {
      throw new Error(`Failed to fetch URL: ${error.message || error}`);
    }

    if (response.status >= 400) {
      throw new Error(`Failed to fetch URL: status ${response.status}.`);
    }

    const contentType =
      response.headers?.["content-type"] ||
      response.headers?.["Content-Type"] ||
      "";
    let content = response.text || "";
    const looksLikeHtml = /^\s*<(?:!doctype|html|head|body)\b/i.test(content);

    if (contentType.includes("application/json")) {
      try {
        content = safeJson(JSON.parse(content));
      } catch {
        content = response.text || "";
      }
    } else if (contentType.includes("html") || looksLikeHtml) {
      content = htmlToText(content);
    }

    return {
      ok: true,
      url,
      content_type: contentType || "unknown",
      summary: `Fetched ${url}.`,
      content: truncateText(content, maxChars),
      truncated: content.length > maxChars,
    };
  }

  getVaultGitRoot() {
    return this.app.vault?.adapter?.basePath || "";
  }

  async runGit(args) {
    const cwd = this.getVaultGitRoot();
    if (!cwd) {
      throw new Error("Git tools only work in the desktop app with a local vault path.");
    }

    try {
      return await execFileAsync("git", args, {
        cwd,
        maxBuffer: 5 * 1024 * 1024,
      });
    } catch (error) {
      const output = [error.stdout, error.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      throw new Error(output || error.message || "Git command failed.");
    }
  }

  async ensureGitRepository() {
    await this.runGit(["rev-parse", "--is-inside-work-tree"]);
  }

  async toolGitStatus() {
    await this.ensureGitRepository();
    const result = await this.runGit(["status", "--short", "--branch"]);

    return {
      ok: true,
      summary: "Loaded git status for the vault repository.",
      repository: this.getVaultGitRoot(),
      status: cleanText(result.stdout) || "clean",
    };
  }

  async toolGitCommitAndPush(input = {}) {
    await this.ensureGitRepository();

    const message = cleanText(input.message);
    if (!message) {
      throw new Error("Commit message is required.");
    }

    const paths = Array.isArray(input.paths)
      ? input.paths.map((path) => normalizeVaultPath(path)).filter(Boolean)
      : [];

    if (paths.length) {
      await this.runGit(["add", "--", ...paths]);
    } else {
      await this.runGit(["add", "-A"]);
    }

    let commitOutput = "";
    try {
      const result = await this.runGit(["commit", "-m", message]);
      commitOutput = cleanText(`${result.stdout}\n${result.stderr}`);
    } catch (error) {
      if (/nothing to commit|no changes added/i.test(error.message)) {
        return {
          ok: true,
          pushed: false,
          summary: "There were no staged changes to commit.",
        };
      }
      throw error;
    }

    const pushResult = await this.runGit([
      "push",
      "-u",
      this.settings.gitRemote || "origin",
      "HEAD",
    ]);

    return {
      ok: true,
      pushed: true,
      summary: `Committed and pushed changes to ${this.settings.gitRemote || "origin"}.`,
      commit_message: message,
      output: cleanText(
        [commitOutput, pushResult.stdout, pushResult.stderr]
          .filter(Boolean)
          .join("\n")
      ),
    };
  }

  onunload() {}
}

module.exports = ClaudeChatPlugin;
