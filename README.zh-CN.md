[English](./README.md) | [简体中文](./README.zh-CN.md)

# Claude Chat for Obsidian

Claude Chat 是一个面向 Obsidian 的 Claude 助手插件。它的目标不是做一个“只能聊天”的侧边栏，而是把 Claude 变成一个真正能操作笔记库的实用助手。

它可以读取、创建、编辑、移动和整理你的笔记，也可以联网搜索、解析图片，并且在需要时执行 Git 工作流。

## 这个插件为什么存在

很多 Obsidian 里的 Claude 方案都依赖本地 CLI、中间进程，或者额外的登录桥接流程。

这个插件的路线更直接：

- 直接连接你自己的 `baseUrl`
- 不依赖 Claude CLI
- 不需要 `/login`
- 不需要本地 CLI 子进程做中转
- 适合 Anthropic 兼容网关、代理服务和自建接口

只要你的接口能兼容 `/v1/messages`，就可以直接接入。

## 核心优势

### 1. 直接配置 `baseUrl`

你只需要编辑一个配置文件，就能连接到自己的 API 网关或代理：

- `apiKey`
- `baseUrl`
- `model`
- `maxTokens`
- `gitRemote`

不需要额外安装或认证任何 CLI。

### 2. 真正可操作笔记库

Claude 不只是回答问题，它还可以直接在你的 vault 中工作，例如：

- 读取当前笔记
- 列出笔记
- 搜索笔记内容
- 打开笔记
- 创建笔记
- 整篇替换笔记内容
- 追加内容
- 精确替换指定文本
- 移动或重命名笔记

### 3. 支持图片解析

你可以直接在聊天界面上传图片，或者把截图粘贴进输入框，让 Claude 解析图片内容。

支持两种输入方式：

- 点击 `Image` 按钮选择图片
- 直接粘贴截图到输入框

需要注意：

- 图片解析是否成功，取决于你配置的 `baseUrl` 和模型是否支持图片输入
- 如果上游接口不支持 vision，插件会把上游返回的错误直接展示出来

### 4. 支持联网和 Git 工作流

插件还支持：

- 公网搜索
- 抓取公开网页
- 查看 Git 状态
- 提交并推送到 GitHub 或其他 Git 远程仓库

所以它不仅适合聊天，也适合写作、研究、整理知识库和发布流程。

## 功能特性

- 直接兼容 Anthropic 风格 API
- 支持工具调用的笔记操作能力
- 使用 Obsidian 原生 Markdown 渲染
- 支持图片上传和截图粘贴
- 支持联网搜索和网页抓取
- 支持可选 Git 集成
- 使用独立配置文件保存连接信息和敏感配置
- 桌面端专用，适合本地文件系统和 Git 场景

## 安装方式

### 手动安装

1. 把插件文件夹复制到：

   `.obsidian/plugins/claude-chat`

2. 确保目录中包含这些文件：

   - `manifest.json`
   - `main.js`
   - `styles.css`

3. 在 Obsidian 中启用插件：

   `设置 -> 第三方插件`

4. 打开插件目录并编辑：

   `claude-chat.config.json`

5. 重载 Obsidian，或禁用后重新启用插件。

## 配置方式

插件把连接信息存放在：

`claude-chat.config.json`

示例：

```json
{
  "apiKey": "your-token",
  "baseUrl": "https://your-api-host.example.com",
  "model": "claude-opus-4-6-thinking",
  "maxTokens": 16384,
  "gitRemote": "origin"
}
```

仓库中同时提供了：

- `claude-chat.config.example.json` 作为模板

以下本地运行文件默认不会被 Git 跟踪：

- `claude-chat.config.json`
- `data.json`

## 插件会保存什么

### `claude-chat.config.json`

保存敏感或部署相关配置：

- API key
- base URL
- model
- token 上限
- Git remote

### `data.json`

只保存本地运行偏好：

- 功能开关
- 本地 UI / 运行行为配置

这种设计更适合安全地开源。

## 使用示例

### 笔记整理

- “读取当前笔记并整理成 5 个重点”
- “在 `Inbox/Weekly Review.md` 新建一篇今日总结”
- “搜索笔记库里和 `project alpha` 有关的内容并整理出来”

### 写作工作流

- “把这份草稿整理成更清晰的文章大纲”
- “把这份会议记录重写成行动项和决策列表”
- “给当前笔记追加一个简短总结”

### 研究工作流

- “搜索关于 X 的最新资料并写入当前笔记”
- “读取这些相关笔记并合并成一份摘要”

### 图片工作流

- “分析这张截图并解释里面的内容”
- “提取这张白板照片里的主要信息”
- “看看这张图片，并把它整理成结构化笔记”

### Git 工作流

- “查看 git 状态”
- “提交并推送今天的笔记修改”

## 当前工具集

Vault 工具：

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

Web 工具：

- `web_search`
- `fetch_url`

Git 工具：

- `git_status`
- `git_commit_and_push`

## 安全说明

这个插件可以修改笔记内容，也可以在启用时执行 Git 命令。

正式使用前，你应该清楚：

- 它可以创建和编辑 vault 里的 Markdown 文件
- 它可以抓取公开网页内容
- 如果启用了 Git 工具，它可以执行 commit 和 push

建议：

- 给你的 vault 配置版本控制
- 在推送前检查生成内容
- 不要把真实的 `claude-chat.config.json` 提交到公开仓库

## 图片支持说明

图片上传能力是在插件内部实现的。

这意味着：

- UI 层支持选择图片
- UI 层支持直接粘贴截图
- 图片会在本地编码后，以消息内容块形式发送给模型

真正能不能成功解析，取决于你的上游 API。

如果你的接口支持 Anthropic 风格的图片输入，这个功能应该可以工作。
如果接口不支持，插件仍然会正确发出请求，但上游服务会返回错误。

## 开源准备情况

当前仓库结构已经尽量适合直接开源：

- 敏感配置已经和源码分离
- 插件不依赖 Claude CLI
- 用户只需要填写自己的配置文件即可使用

如果你要进入 Obsidian 社区插件目录，后面还需要补这些内容：

- 公开的 GitHub 仓库
- 带版本号的 GitHub Releases
- `LICENSE`
- 向 Obsidian 社区插件列表提交 PR

## 常见问题

### 这个插件需要 Claude CLI 吗？

不需要。

它直接请求你配置的 API `baseUrl`。

### 支持自定义 API 网关吗？

支持。

只要你的网关兼容预期的 `/v1/messages` 行为，就可以直接接入。

### 图片解析真的支持吗？

插件侧支持。

最终是否成功，取决于你配置的 API 服务和模型是否支持图片输入。

### 本地使用一定要 GitHub 吗？

不需要。

GitHub 只有在下面这些场景才是必须的：

- 你要公开插件源码
- 你要发布 release 附件
- 你要把笔记改动 push 到远程仓库

## License

正式发布前，请补充你选择的开源许可证。
