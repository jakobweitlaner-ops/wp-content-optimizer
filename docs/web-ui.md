# Web UI & REST API

Start the server:

```bash
npm run ui
# or
node src/server.js
```

Opens at **http://localhost:3000** (configure port via `UI_PORT` env var).

---

## Web UI Features

The browser UI (`src/public/index.html`) provides a dashboard with six tabs:

| Tab | Description |
|---|---|
| **Dashboard** | Run any CLI command and stream its output live |
| **SEO Optimizer** | Review all posts with low SEO scores, generate AI fixes per field, apply in bulk |
| **Media Optimizer** | See images with missing alt text, generate AI alt texts, apply in bulk |
| **H1 Overview** | Review and fix H1 headings and keyphrases across all content |
| **Bild Management** | Rename image filenames via AI, compress oversized images, upload replacements from PC |
| **Bildaustausch** | Seasonal/thematic image replacement — swap images across posts from the media library |

All fix workflows follow a **Preview → Select → Apply** pattern — no changes are written without explicit confirmation.

---

## REST API Endpoints

The Express server exposes these endpoints:

### Streaming Command Runner

```
GET /run/:command
```

Streams Server-Sent Events while running a CLI command in a child process.

**Allowed commands:** `test-connection`, `check-links`, `audit-seo`, `audit-media`, `get-status`

**Query params:**
- `?ai=1` — enables `--ai` flag for `audit-seo`
- `?fix=1` — enables `--fix` flag for `audit-media`

**SSE event format:**
```json
{ "type": "out" | "err" | "done", "text": "..." }
```

`done` text is `"success"` or `"error"` based on exit code.

---

### AI Alt-Text Preview

```
GET /preview/audit-media-ai
```

Streams SSE events with AI-generated alt-text proposals for every image.
Requires `ANTHROPIC_API_KEY`. Analyzes images visually using `claude-haiku-4-5-20251001`.

**SSE events:** `progress`, `out` (proposal), `err`, `proposals` (final array), `done`

**Proposals payload:**
```json
[{
  "id": 123,
  "filename": "my-image",
  "url": "https://site.com/wp-content/...",
  "currentAltText": "",
  "proposedAltText": "Gemütlicher Wohnbereich mit Bergblick",
  "reason": "..."
}]
```

---

### SEO Audit Data

```
GET /api/seo-audit
```

Returns all posts/pages as a JSON array, sorted by SEO score ascending.
Each item contains: `id`, `type`, `title`, `url`, `score`, `issues`, `wordCount`, `h1Count`, `h2Count`, `currentH1`, `currentIntro`, `currentYoastTitle`, `currentYoastDesc`, `currentKeyphrase`, `lang`, `headingFormat`, `isNoindex`.

---

### H1 Overview

```
GET /api/h1-overview
```

Lightweight version of the SEO audit — returns only fields needed for the H1 tab:
`id`, `type`, `title`, `url`, `lang`, `currentH1`, `currentKeyphrase`, `hasBrandIssue`.

---

### Generate AI SEO Fix

```
GET /api/seo-fix?id=<n>&type=post|page&field=<field>&keyphrase=<kp>
```

Generates an AI fix for a single field of a single post/page.
Requires `ANTHROPIC_API_KEY`.

**Supported fields:**

| `field` | What is generated |
|---|---|
| `title` | Improved Yoast SEO title (20–60 chars) |
| `excerpt` | Improved meta description (120–140 chars) |
| `h1` | Optimized H1 heading text |
| `intro` | Rewritten or new first paragraph |
| `content` | Expanded paragraphs (increases word count) |
| `keyphrase` | Suggested focus keyphrase (2–4 words) |

**Response:** `{ "value": "generated text" }` or `{ "value": null }` if nothing was generated.

---

### Set Noindex

```
POST /api/seo-noindex
Content-Type: application/json

{ "id": 42, "type": "post", "noindex": true }
```

Toggles the Yoast `_yoast_wpseo_meta-robots-noindex` meta field.

---

### Fix Brand Name

```
POST /api/seo-fix-brand
Content-Type: application/json

{ "id": 42, "type": "post" }
```

Scans and corrects brand name spelling in Yoast title, meta description, and post content.
Returns `{ "fixed": ["Yoast-Titel", "Inhalt"] }` listing which fields were updated.

---

### SEO Image Alt Proposals

```
GET /api/seo-images?id=<n>&type=post|page&keyphrase=<kp>
```

Returns AI-generated alt text proposals for all images embedded in a post/page, incorporating the focus keyphrase.
Requires `ANTHROPIC_API_KEY`.

**Response:**
```json
[{
  "imageId": 123,
  "filename": "my-photo.jpg",
  "currentAlt": "",
  "proposedAlt": "Moderne Ferienwohnung mit Blick auf die Berge"
}]
```

---

### SEO Fix Preview (streaming)

```
GET /preview/audit-seo
```

Streams AI-generated title and excerpt fixes for all posts below the score threshold (80).
Returns `proposals` event with array of `{ id, type, title, url, field, issue, currentValue, proposedValue }`.

---

### Apply SEO Fixes

```
POST /apply/audit-seo
Content-Type: application/json

{ "changes": [{ "id": 42, "type": "post", "field": "title", "value": "New Title" }] }
```

Streams SSE progress while applying fixes to WordPress via the REST API.
Supported fields: `title`, `excerpt`, `keyphrase`, `h1`, `intro`, `content`.
For `h1` and `intro`, the full Gutenberg/classic HTML is patched in-place.

---

### Media Fix Preview

```
GET /preview/audit-media
```

Returns JSON array of images with missing alt text and rule-based (non-AI) alt text proposals.

---

### Apply Media Fixes

```
POST /apply/audit-media
Content-Type: application/json

{ "changes": [{ "id": 123, "altText": "Bergpanorama mit Schnee" }] }
```

Streams SSE progress while writing alt texts to WordPress.

---

### AI Filename Audit (streaming)

```
GET /preview/audit-filenames
```

Streams SSE events with AI-generated filename proposals for images that have poor, generic, or non-descriptive filenames.
Requires `ANTHROPIC_API_KEY`.

**SSE events:** `progress`, `out` (single proposal line), `err`, `proposals` (final array), `done`

**Proposals payload:**
```json
[{
  "id": 123,
  "currentFilename": "img_4567",
  "proposedFilename": "summer-terrace-sunset",
  "reason": "Generic camera filename, no semantic meaning",
  "quality": "poor"
}]
```

---

### Apply Filename Renames (streaming)

```
POST /apply/audit-filenames
Content-Type: application/json

{ "changes": [{ "id": 123, "newFilename": "summer-terrace-sunset" }] }
```

Re-uploads each selected image under the new filename, updates all post/page content references and `featured_media` IDs, then deletes the original file.
Streams SSE progress events.

---

### Rename Single Image

```
POST /api/rename-image
Content-Type: application/json

{ "id": 123, "newFilename": "summer-terrace-sunset" }
```

Renames one media item synchronously.

**Response:** `{ originalId, originalUrl, originalFilename, newId, newUrl, newFilename, urlMappings, refsUpdated, featuredUpdated }`

---

### Detect Oversized Images

```
GET /api/compress-images/detect?threshold=<bytes>
```

Returns images whose file size exceeds `threshold` (default: 204800 = 200 KB) and that are in a compressible format (JPEG, PNG, WebP).

**Response:** array of `{ id, filename, url, sizeKb, width, height, mimeType, altText }`

---

### Compress Images (streaming)

```
POST /api/compress-images/apply
Content-Type: application/json

{
  "ids": [123, 456],
  "targetSizeKb": 150,
  "quality": 82,
  "maxWidth": 2560,
  "maxHeight": 2560,
  "threshold": 204800
}
```

Compresses the selected images (or all oversized ones if `ids` is omitted). Streams SSE progress. Updates all post references after each compression.

---

### Repair Post References (streaming)

```
POST /api/repair-references
```

Scans all posts/pages (all Polylang language variants) and corrects broken image URLs by matching filename slugs against the current media library. Streams SSE progress.

---

### Upload Image from PC (streaming)

```
POST /api/upload-from-pc?postId=<n>&postType=post|page&mode=featured|content&oldMediaId=<n>&oldSrc=<url>&filename=<name>
Content-Type: <mime-type>
Body: <raw binary image data>
```

Uploads a local file as a new WordPress media item, then replaces the old image in the specified post. Streams SSE progress.

---

### Seasonal Image Replacement

```
GET /api/seasonal/config
```
Returns `{ wpBase: "https://your-site.com" }` — the WP base URL the frontend uses to detect which image URLs need to be proxied.

```
GET /api/seasonal/proxy-image?url=<encoded-url>
```
Server-side image proxy that forwards WP media URLs to avoid browser SSL or CORS issues.

```
GET /api/seasonal/posts
```
Streams SSE events (`post`, `done`, `error`) for all published posts and pages that contain at least one image. Each `post` event payload includes: `id`, `type`, `title`, `url`, `images` (array of `{ src, mediaId }`), `featuredImageId`, `featuredImageUrl`, `translations` (Polylang language variants).

```
GET /api/seasonal/media?page=<n>&search=<term>
```
Returns page `n` (30 items per page) of the media library, optionally filtered by `search`. Used for the replacement image picker.

```
POST /api/seasonal/replace
Content-Type: application/json

{
  "postId": 42,
  "postType": "post",
  "mode": "featured" | "content",
  "oldSrc": "https://...",
  "oldMediaId": 10,
  "newMediaId": 99,
  "newSrc": "https://...",
  "postUrl": "https://..."
}
```
Replaces the specified image in the post content or featured image, updates all size-variant URLs and `featured_media` ID, then optionally purges server-side caches via a HEAD/PURGE request to `postUrl`.
