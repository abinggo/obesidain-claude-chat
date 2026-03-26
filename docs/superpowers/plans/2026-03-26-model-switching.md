# Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `model`/`apiKey`/`baseUrl` config fields with a `models` array of per-provider objects, and add a toolbar dropdown to switch between them.

**Architecture:** All model configuration (credentials + model ID) moves into a `models` array in `claude-chat.config.json`. The active selection is stored as `activeModelLabel` in `data.json`. A new `getCurrentModel()` method on the plugin provides the active model to `createMessage()` and the toolbar.

**Tech Stack:** Obsidian Plugin API, vanilla JS, CSS custom properties (no new dependencies)

---

## Files

- Modify: `main.js` — constants, settings normalization, plugin methods, toolbar, settings tab
- Modify: `styles.css` — add dropdown CSS
- Overwrite: `claude-chat.config.json` — new multi-model format

---

### Task 1: Update EXTERNAL_SETTING_KEYS and DEFAULT_SETTINGS

**Files:**
- Modify: `main.js:20-41`

- [ ] **Step 1: Replace EXTERNAL_SETTING_KEYS**

Find (lines 20-26):
```javascript
const EXTERNAL_SETTING_KEYS = [
  "apiKey",
  "baseUrl",
  "model",
  "maxTokens",
  "gitRemote",
];
```

Replace with:
```javascript
const EXTERNAL_SETTING_KEYS = [
  "models",
  "maxTokens",
  "gitRemote",
];
```

- [ ] **Step 2: Replace DEFAULT_SETTINGS**

Find (lines 28-41):
```javascript
const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://td.geeknow.top",
  model: "claude-opus-4-6-thinking",
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
```

Replace with:
```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "refactor: update EXTERNAL_SETTING_KEYS and DEFAULT_SETTINGS for multi-model support"
```

---

### Task 2: Update normalizeSettings()

**Files:**
- Modify: `main.js:1222-1254`

- [ ] **Step 1: Replace normalizeSettings()**

Find (lines 1222-1254):
```javascript
  normalizeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      apiKey: cleanText(settings.apiKey),
      baseUrl: normalizeBaseUrl(settings.baseUrl || DEFAULT_SETTINGS.baseUrl),
      model: cleanText(settings.model) || DEFAULT_SETTINGS.model,
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
```

Replace with:
```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "refactor: update normalizeSettings for models array"
```

---

### Task 3: Update getExternalConfigTemplate()

**Files:**
- Modify: `main.js:1212-1220`

- [ ] **Step 1: Replace getExternalConfigTemplate()**

Find (lines 1212-1220):
```javascript
  getExternalConfigTemplate() {
    return {
      apiKey: "",
      baseUrl: DEFAULT_SETTINGS.baseUrl,
      model: DEFAULT_SETTINGS.model,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      gitRemote: DEFAULT_SETTINGS.gitRemote,
    };
  }
```

Replace with:
```javascript
  getExternalConfigTemplate() {
    return {
      models: [],
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      gitRemote: DEFAULT_SETTINGS.gitRemote,
    };
  }
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "refactor: update config template for models array"
```

---

### Task 4: Add getCurrentModel() and setActiveModel() to ClaudeChatPlugin

**Files:**
- Modify: `main.js` — add two methods after `activateView()` (around line 1328)

- [ ] **Step 1: Add getCurrentModel() and setActiveModel()**

Find (line ~1329, after `activateView()` closing brace):
```javascript
  async loadSettings() {
```

Insert before that line:
```javascript
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

```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "feat: add getCurrentModel and setActiveModel to plugin"
```

---

### Task 5: Update createMessage() to use getCurrentModel()

**Files:**
- Modify: `main.js:1689-1723`

- [ ] **Step 1: Replace the top of createMessage()**

Find (lines 1689-1722):
```javascript
  async createMessage(messages, signal, options = {}) {
    const baseUrl = normalizeBaseUrl(this.settings.baseUrl);
    if (!baseUrl) {
      throw new Error("Base URL is not configured.");
    }

    const body = {
      model: options.model || this.settings.model,
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
        "x-api-key": this.settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal,
    });
```

Replace with:
```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "feat: createMessage uses getCurrentModel for per-model credentials"
```

---

### Task 6: Update toolbar dropdown in ClaudeChatView.onOpen()

**Files:**
- Modify: `main.js:367-373`

- [ ] **Step 1: Replace model span with dropdown**

Find (lines 367-373):
```javascript
    const toolbarMeta = toolbar.createDiv({ cls: "claude-chat-toolbar-meta" });
    toolbarMeta.createSpan({ text: this.plugin.settings.model });
    toolbarMeta.createSpan({
      cls: "claude-chat-toolbar-status",
      text: this.getModeSummary(),
    });
```

Replace with:
```javascript
    const toolbarMeta = toolbar.createDiv({ cls: "claude-chat-toolbar-meta" });

    const models = this.plugin.settings.models || [];
    const activeModel = this.plugin.getCurrentModel();
    this.modelBtn = toolbarMeta.createEl("button", {
      text: activeModel ? activeModel.label : "No model",
      cls: "claude-chat-model-btn",
    });

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
        dropdown = toolbarMeta.createDiv({ cls: "claude-chat-model-dropdown" });
        models.forEach((m) => {
          const item = dropdown.createDiv({
            cls: "claude-chat-model-dropdown-item",
          });
          const isActive =
            m.label === this.plugin.settings.activeModelLabel ||
            (!this.plugin.settings.activeModelLabel && m === models[0]);
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
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "feat: add model switcher dropdown to toolbar"
```

---

### Task 7: Remove API Key, Base URL, Model fields from settings tab

**Files:**
- Modify: `main.js:1000-1045`

- [ ] **Step 1: Remove the three fields and update description**

Find (lines 1000-1045):
```javascript
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Claude Chat Settings" });
    containerEl.createEl("p", {
      text:
        "Connection settings are stored in claude-chat.config.json next to this plugin. Editing them here will write back to that file.",
    });

    new obsidian.Setting(containerEl)
      .setName("API Key")
      .setDesc("Saved to claude-chat.config.json")
      .addText((text) => {
        text.setPlaceholder("sk-...");
        text.setValue(this.plugin.settings.apiKey);
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          this.plugin.settings.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new obsidian.Setting(containerEl)
      .setName("Base URL")
      .setDesc("Saved to claude-chat.config.json")
      .addText((text) =>
        text
          .setPlaceholder("https://td.geeknow.top")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = normalizeBaseUrl(value);
            await this.plugin.saveSettings();
          })
      );

    new obsidian.Setting(containerEl)
      .setName("Model")
      .setDesc("Saved to claude-chat.config.json")
      .addText((text) =>
        text
          .setPlaceholder("claude-opus-4-6-thinking")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );
```

Replace with:
```javascript
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Claude Chat Settings" });
    containerEl.createEl("p", {
      text:
        "Models and credentials are configured in claude-chat.config.json next to this plugin. Switch models using the dropdown in the chat toolbar.",
    });
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "refactor: remove API Key/Base URL/Model fields from settings tab"
```

---

### Task 8: Add dropdown CSS to styles.css

**Files:**
- Modify: `styles.css` — append after the toolbar button styles (after line ~415)

- [ ] **Step 1: Add CSS after `.claude-chat-toolbar button:disabled` block**

Find (lines 412-415):
```css
.claude-chat-toolbar button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
```

Insert after:
```css

.claude-chat-model-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--chat-border);
  background: color-mix(in srgb, var(--background-primary) 88%, white 12%);
  color: var(--text-muted);
  cursor: pointer;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.claude-chat-model-btn:hover {
  background: var(--background-modifier-hover);
}

.claude-chat-toolbar-meta {
  position: relative;
}

.claude-chat-model-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 100;
  min-width: 200px;
  background: var(--background-primary);
  border: 1px solid var(--chat-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.claude-chat-model-dropdown-item {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-normal);
  cursor: pointer;
  white-space: nowrap;
}

.claude-chat-model-dropdown-item:hover {
  background: var(--background-modifier-hover);
}

.claude-chat-model-dropdown-item.is-active {
  color: var(--interactive-accent);
  font-weight: 600;
}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat: add model dropdown CSS"
```

---

### Task 9: Write new claude-chat.config.json

**Files:**
- Overwrite: `claude-chat.config.json`

- [ ] **Step 1: Replace the entire file**

Write the following content to `claude-chat.config.json`:
```json
{
  "models": [
    {
      "label": "Tengda Opus 4.6 Thinking",
      "model": "claude-opus-4-6-thinking",
      "baseUrl": "https://td.geeknow.top",
      "apiKey": "sk-bysnciSns9o9bY3yIa4YnU1cfVS8R44C2jifthaZZhHOAR8P"
    },
    {
      "label": "Cloudsway Sonnet 4.6",
      "model": "claude-sonnet-4@20250514",
      "baseUrl": "https://genaiapi.cloudsway.net/tRPkLcCCfLOPkUoD",
      "apiKey": "fg0qMhXAax6GFWYiBQRF"
    },
    {
      "label": "Kimi K2.5 (OpenRouter)",
      "model": "moonshotai/kimi-k2",
      "baseUrl": "https://openrouter.ai/api",
      "apiKey": "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"
    },
    {
      "label": "MiniMax M2.5 (OpenRouter)",
      "model": "minimax/minimax-01",
      "baseUrl": "https://openrouter.ai/api",
      "apiKey": "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"
    },
    {
      "label": "MiniMax M2.7 (OpenRouter)",
      "model": "minimax/minimax-m2.7",
      "baseUrl": "https://openrouter.ai/api",
      "apiKey": "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"
    }
  ],
  "maxTokens": 16384,
  "gitRemote": "origin"
}
```

- [ ] **Step 2: Commit**

```bash
git add claude-chat.config.json
git commit -m "config: set up 5-model configuration for multi-model switching"
```

---

## Verification

After all tasks, manually verify in Obsidian:

1. Open Claude Chat — toolbar shows the first model label ("Tengda Opus 4.6 Thinking") as a button
2. Click the button — dropdown opens with all 5 models, checkmark on active one
3. Click a different model — button updates, dropdown closes
4. Close and reopen Claude Chat — button shows the previously selected model (persisted)
5. Send a message — reply comes back (confirms API call uses the correct credentials)
6. Open Settings → Claude Chat — no API Key / Base URL / Model fields visible
