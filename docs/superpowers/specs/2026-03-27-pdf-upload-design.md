# PDF Upload Support

**Date:** 2026-03-27
**Status:** Approved

## Summary

Add PDF file upload to the existing attachment pipeline so users can send PDFs alongside text in the chat. The Claude API natively supports PDFs as `document` content blocks.

## Approach

Minimal changes to the existing image upload pipeline. No renaming of existing structures — PDF items are added to `pendingImages` with a `type: "pdf"` field to distinguish them from images.

## Changes

### 1. Constants

Add `MAX_PDF_BYTES = 20 * 1024 * 1024` (20 MB).

### 2. File picker

Change `accept="image/*"` to `accept="image/*,.pdf"` on `this.fileInputEl`.

Also update the drag-and-drop handler to accept PDF files (currently filters on `item.type.startsWith("image/")`).

### 3. `fileToPdfAttachment(file)`

New function parallel to `fileToImageAttachment`. Reads the file as base64 and returns:
```js
{ type: "pdf", name, size, data, mediaType: "application/pdf" }
```
Throws if `file.size > MAX_PDF_BYTES`.

### 4. `addPendingImages(files)` dispatch

Route each file: images → `fileToImageAttachment`, PDFs → `fileToPdfAttachment`.

### 5. UI card rendering (`renderImageGallery`)

- **Image**: existing `<img>` thumbnail (unchanged)
- **PDF**: document icon placeholder (`📄`) in place of thumbnail, same name/size/remove UI

### 6. API message building

When constructing the `content` array for the API call:
- Image attachment → existing `{ type: "image", source: { type: "base64", ... } }`
- PDF attachment → `{ type: "document", source: { type: "base64", media_type: "application/pdf", data: ... } }`

## Constraints

- Max PDF size: 20 MB (Claude API hard limit is 32 MB)
- No DOCX support in this change
- Conversation history rendering: PDFs already in `attachments` array are rendered as doc cards (no re-parsing needed)

## Out of Scope

- DOCX support
- PDF page previews
- Renaming existing image-related variables
