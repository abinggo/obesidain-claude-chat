# Model Switching Design

**Date:** 2026-03-26
**Status:** Approved

## Overview

Replace the single `model` field in `claude-chat.config.json` with a `models` array of objects, each containing its own credentials. Add a toolbar dropdown in the Chat UI to switch between models. The active model is persisted in `data.json`.

---

## Config Format

`claude-chat.config.json` replaces `apiKey`, `baseUrl`, and `model` with a `models` array:

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

Each model entry has four required fields: `label`, `model`, `baseUrl`, `apiKey`.
`maxTokens` and `gitRemote` remain global.
Top-level `apiKey`, `baseUrl`, and `model` fields are removed entirely.

**Note:** OpenRouter model IDs for Kimi and MiniMax are best-effort — verify at openrouter.ai/models.

---

## Active Model Persistence

`activeModelLabel` is stored in Obsidian's `data.json` (plugin data, not config file):

```json
{
  "activeModelLabel": "Cloudsway Sonnet 4.6"
}
```

**Fallback rule:** If `activeModelLabel` is absent or does not match any entry in `models`, fall back to `models[0]`.

---

## UI: Toolbar Dropdown

The model name span in the toolbar becomes a clickable dropdown button.

```
[▾ Cloudsway Sonnet 4.6] [模式状态]    [整理成笔记] [New Chat]
 ┌──────────────────────────┐
 │ ✓ Tengda Opus 4.6 Thinking│
 │   Cloudsway Sonnet 4.6    │
 │   Kimi K2.5 (OpenRouter)  │
 │   MiniMax M2.5 (OpenRouter)│
 │   MiniMax M2.7 (OpenRouter)│
 └──────────────────────────┘
```

Behavior:
- Click button → toggle dropdown open/closed
- Click outside → close dropdown
- Click a model → close dropdown, update button label, save `activeModelLabel` to `data.json`
- Current conversation history is preserved; next message uses the new model
- No chat reset on model switch

---

## Code Changes (main.js)

### 1. Constants & Defaults

- `EXTERNAL_SETTING_KEYS`: remove `apiKey`, `baseUrl`, `model`; add `models`
- `DEFAULT_SETTINGS`: remove `apiKey`, `baseUrl`, `model`; add `models: []`
- New plugin-level property: `this.activeModelLabel` (loaded from `data.json`, not settings)

### 2. `normalizeSettings()`

- Validate `models` array: each entry must have non-empty `label`, `model`, `baseUrl`, `apiKey`
- Remove normalization for `apiKey`, `baseUrl`, `model`

### 3. New `getCurrentModel()` method on plugin

```javascript
getCurrentModel() {
  const models = this.settings.models || [];
  return models.find(m => m.label === this.activeModelLabel)
         || models[0]
         || null;
}
```

### 4. New `setActiveModel(label)` method on plugin

```javascript
async setActiveModel(label) {
  this.activeModelLabel = label;
  const data = await this.loadData() || {};
  data.activeModelLabel = label;
  await this.saveData(data);
}
```

### 5. `createMessage()`

Replace `this.settings.baseUrl`, `this.settings.model`, and the API key lookup with:

```javascript
const activeModel = this.plugin.getCurrentModel();
// use activeModel.baseUrl, activeModel.apiKey, activeModel.model
```

### 6. Toolbar (`onOpen()`)

- Replace `toolbarMeta.createSpan({ text: this.plugin.settings.model })` with a `<button>` element
- Button click creates/toggles a floating `<div>` listing all models
- Each list item calls `this.plugin.setActiveModel(label)` then updates button text
- `document.addEventListener('click', ...)` closes the dropdown on outside click

### 7. Settings Tab (`ClaudeChatSettingTab`)

- Remove the API Key, Base URL, and Model input fields
- These are now managed per-model in `claude-chat.config.json`

---

## Data Flow

```
claude-chat.config.json
  └─ models[]  (list of available models with credentials)

data.json
  └─ activeModelLabel  (which model is currently selected)

Runtime:
  plugin.settings.models  +  plugin.activeModelLabel
       └─> getCurrentModel()  →  { label, model, baseUrl, apiKey }
               └─> createMessage()  (API call)
```

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| `models` array is empty | Show error notice: "No models configured in claude-chat.config.json" |
| `activeModelLabel` not in list | Fall back to `models[0]` silently |
| Model entry missing required field | Skip that entry during normalization, log warning |
| Config file reloaded with different models | Re-evaluate `activeModelLabel` fallback on next `getCurrentModel()` call |
