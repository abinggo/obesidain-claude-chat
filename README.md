[English](./README.md) | [简体中文](./README.zh-CN.md)

# Claude Chat for Obsidian

Claude Chat is an Obsidian plugin that turns Claude into a practical vault assistant instead of a plain chat window.

It can read, create, edit, move, and organize notes in your vault, search the web, inspect images, and optionally run Git workflows for your note repository.

## Why This Plugin Exists

Most Claude-in-Obsidian solutions rely on a local CLI bridge or a separate subprocess login flow.

This plugin takes a simpler route:

- Direct API connection through your own `baseUrl`
- No Claude CLI required
- No `/login` flow
- No local CLI subprocess acting as a fragile middle layer
- Easy deployment with Anthropic-compatible gateways, proxies, or self-hosted endpoints

If your API endpoint works with `/v1/messages`, you can point the plugin at it directly.

## Key Advantages

### 1. Direct `baseUrl` configuration

You can connect the plugin directly to your own API gateway or proxy by editing one config file:

- `apiKey`
- `baseUrl`
- `model`
- `maxTokens`
- `gitRemote`

There is no requirement to install or authenticate a separate CLI.

### 2. Built-in vault actions

Claude can do real work inside your vault, including:

- read the active note
- list notes
- search note content
- open notes
- create notes
- replace note content
- append content
- replace exact text in a note
- move or rename notes

### 3. Image understanding

You can attach images directly in the chat UI and ask Claude to analyze them.

Supported input methods:

- click the `Image` button to choose files
- paste screenshots directly into the input area

Important:

- image analysis depends on your configured `baseUrl` and model supporting image content blocks
- if your upstream API does not support vision, the plugin will return the upstream API error

### 4. Web + Git workflows

The plugin can also:

- search the public web
- fetch public URLs
- inspect Git status
- commit and push changes to GitHub or another Git remote

This makes it useful for writing, research, note cleanup, and publishing workflows from inside Obsidian.

## Features

- Direct Anthropic-compatible API integration
- Tool-use workflow for note operations
- Obsidian-aware Markdown rendering
- Image upload and screenshot paste support
- Web search and page fetch tools
- Optional Git integration
- Separate local config file for secrets and connection settings
- Desktop-only mode for local filesystem and Git support

## Installation

### Manual installation

1. Copy this folder to:

   `.obsidian/plugins/claude-chat`

2. Make sure these files are present:

   - `manifest.json`
   - `main.js`
   - `styles.css`

3. Enable the plugin in:

   `Settings -> Community plugins`

4. Open the plugin folder and edit:

   `claude-chat.config.json`

5. Reload Obsidian or disable and re-enable the plugin.

## Configuration

The plugin stores connection settings in:

`claude-chat.config.json`

Example:

```json
{
  "apiKey": "your-token",
  "baseUrl": "https://your-api-host.example.com",
  "model": "claude-opus-4-6-thinking",
  "maxTokens": 16384,
  "gitRemote": "origin"
}
```

The repository includes:

- `claude-chat.config.example.json` as a template

Local runtime files are ignored by Git:

- `claude-chat.config.json`
- `data.json`

## What the Plugin Stores

### In `claude-chat.config.json`

Sensitive or deployment-specific settings:

- API key
- base URL
- model
- token limit
- Git remote

### In `data.json`

Local runtime preferences only:

- feature toggles
- UI/runtime behavior flags

This makes the plugin easier to open-source safely.

## Usage Examples

### Note organization

- "Read the current note and turn it into 5 key takeaways."
- "Create a note in `Inbox/Weekly Review.md` with a summary of today."
- "Search notes for `project alpha` and group the findings."

### Writing workflows

- "Turn this rough note into a cleaner article outline."
- "Rewrite this meeting note into action items and decisions."
- "Append a short summary section to the current note."

### Research workflows

- "Search the web for the latest information on X and write it into the current note."
- "Open these related notes and merge them into a single summary."

### Image workflows

- "Analyze this screenshot and explain what it shows."
- "Extract the main information from this whiteboard photo."
- "Look at this image and turn it into structured notes."

### Git workflows

- "Show git status."
- "Commit and push today's note changes."

## Current Tool Set

Vault tools:

- `get_active_note`
- `list_notes`
- `search_notes`
- `read_note`
- `create_note`
- `replace_note`
- `append_note`
- `replace_in_note`
- `move_note`
- `open_note`

Web tools:

- `web_search`
- `fetch_url`

Git tools:

- `git_status`
- `git_commit_and_push`

## Security Notes

This plugin can modify notes and optionally run Git commands in the vault repository.

Before enabling it for daily use, make sure you understand:

- it can create and edit markdown files in your vault
- it can fetch public web content
- it can run Git commit and push commands if Git tools are enabled

Recommendations:

- use version control for your vault
- review generated changes before pushing
- keep your real `claude-chat.config.json` private

## Image Support Notes

Image upload is implemented in the plugin itself.

That means:

- the UI supports selecting images
- the UI supports pasting screenshots
- images are encoded locally and sent as message content blocks

Whether a request succeeds depends on your upstream API endpoint.

If your endpoint supports Anthropic-style image inputs, image analysis should work.
If not, the plugin will still send the request correctly, but the upstream service may reject it.

## Open Source Readiness

This repository is structured so it can be published safely:

- secrets are separated from tracked source files
- the plugin works without Claude CLI
- users only need to fill in their own config file

For community release, you will still want:

- a public GitHub repository
- tagged releases
- a license file
- a community-plugin submission PR to the Obsidian plugin list

## FAQ

### Does this require Claude CLI?

No.

The plugin talks directly to your configured API `baseUrl`.

### Does this support custom API gateways?

Yes.

If the gateway is compatible with the expected `/v1/messages` behavior, you can point the plugin to it directly.

### Does image analysis work?

Yes on the plugin side.

Whether the request succeeds depends on whether your configured API provider and model support image inputs.

### Do I need GitHub for local use?

No.

GitHub is only needed if you want to publish the plugin source, use release assets, or push note changes to a remote repository.

## License

Add your preferred open-source license before publishing.
