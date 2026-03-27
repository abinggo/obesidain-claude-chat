# PDF Upload Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to attach PDF files via the existing 📎 button, which get sent to Claude as native `document` content blocks.

**Architecture:** Four surgical edits to `main.js` — add constant + new helper function, update file picker `accept`, route PDFs in `addPendingImages`, branch on type in `renderImageGallery` and `sendMessage`.

**Tech Stack:** Claude API `document` content block, FileReader API (browser), Obsidian Notice API.

---

## File Map

| File | Change |
|------|--------|
| `main.js:17` | Add `MAX_PDF_BYTES` constant |
| `main.js:462` | Update `accept` on file input |
| `main.js:903–933` | Add `fileToPdfAttachment()` after `fileToImageAttachment()` |
| `main.js:939–953` | Branch PDF vs image in `addPendingImages` loop |
| `main.js:853–865` | Branch PDF card vs image card in `renderImageGallery` |
| `main.js:563–581` | Branch `document` vs `image` block in `sendMessage` |

---

### Task 1: Add `MAX_PDF_BYTES` constant and `fileToPdfAttachment` function

**Files:**
- Modify: `main.js:17`, `main.js:933`

- [ ] **Step 1: Add `MAX_PDF_BYTES` constant on line 17**

  In `main.js`, after line 17 (`const MAX_IMAGE_BYTES = 5 * 1024 * 1024;`), insert:

  ```js
  const MAX_PDF_BYTES = 20 * 1024 * 1024;
  ```

- [ ] **Step 2: Add `fileToPdfAttachment` method after `fileToImageAttachment`**

  `fileToImageAttachment` ends at line 933 (after adding the constant it becomes 934). Insert this new method immediately after:

  ```js
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
  ```

  Note: no `previewUrl` field — PDFs cannot be previewed as images.

- [ ] **Step 3: Commit**

  ```bash
  git add main.js
  git commit -m "feat: add MAX_PDF_BYTES constant and fileToPdfAttachment helper"
  ```

---

### Task 2: Update file picker to accept PDFs

**Files:**
- Modify: `main.js` (file input `accept` attribute, ~line 462)

- [ ] **Step 1: Change `accept` value**

  Find (around line 462):
  ```js
        accept: "image/*",
  ```

  Replace with:
  ```js
        accept: "image/*,.pdf",
  ```

- [ ] **Step 2: Verify in Obsidian**

  Reload plugin (Cmd+P → "Reload app without saving"). Click 📎 — the system file picker should now show PDFs alongside images.

- [ ] **Step 3: Commit**

  ```bash
  git add main.js
  git commit -m "feat: allow PDF files in attachment file picker"
  ```

---

### Task 3: Route PDFs in `addPendingImages`

**Files:**
- Modify: `main.js` `addPendingImages` method (~line 939)

- [ ] **Step 1: Add PDF routing inside the loop**

  Find the loop body (around line 947–952):
  ```js
      try {
        const attachment = await this.fileToImageAttachment(file);
        this.pendingImages.push(attachment);
      } catch (error) {
        new obsidian.Notice(error.message || String(error));
      }
  ```

  Replace with:
  ```js
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
  ```

- [ ] **Step 2: Verify**

  Reload plugin. Attach a PDF — it should be added to `pendingImages` without error (no UI card yet, that's Task 4).

- [ ] **Step 3: Commit**

  ```bash
  git add main.js
  git commit -m "feat: route PDF files to fileToPdfAttachment in addPendingImages"
  ```

---

### Task 4: Render PDF attachment cards in `renderImageGallery`

**Files:**
- Modify: `main.js` `renderImageGallery` method (~line 853)

- [ ] **Step 1: Branch on `attachment.type` for the preview element**

  Find (around line 854–865):
  ```js
      const card = gallery.createDiv({ cls: "claude-chat-attachment-card" });
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
  ```

  Replace with:
  ```js
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
  ```

- [ ] **Step 2: Add CSS for PDF icon**

  In `styles.css`, after `.claude-chat-attachment-thumb { ... }` block (~line 224), add:

  ```css
  .claude-chat-attachment-pdf-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    background: color-mix(in srgb, var(--background-secondary) 88%, white 12%);
  }
  ```

- [ ] **Step 3: Verify**

  Reload plugin. Attach a PDF — you should see a card with 📄 icon, filename, and size.

- [ ] **Step 4: Commit**

  ```bash
  git add main.js styles.css
  git commit -m "feat: render PDF attachment cards with doc icon in chat UI"
  ```

---

### Task 5: Send PDFs as `document` blocks in API messages

**Files:**
- Modify: `main.js` `sendMessage` method (~line 563)

- [ ] **Step 1: Branch on `attachment.type` when building `userContent`**

  Find (around line 563–581):
  ```js
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
  ```

  Replace with:
  ```js
    attachments.forEach((attachment) => {
      if (attachment.type === "pdf") {
        userContent.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: attachment.data,
          },
        });
      } else {
        userContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.mediaType,
            data: attachment.data,
          },
        });
      }
    });

    if (text) {
      userContent.push({ type: "text", text });
    } else if (attachments.length) {
      userContent.push({
        type: "text",
        text: "Please analyze the attached file and answer the user's implied request.",
      });
    }
  ```

- [ ] **Step 2: Verify end-to-end**

  Reload plugin. Attach a PDF, type a question, send. Claude should respond with content extracted from the PDF.

- [ ] **Step 3: Commit**

  ```bash
  git add main.js
  git commit -m "feat: send PDF attachments as document content blocks to Claude API"
  ```
