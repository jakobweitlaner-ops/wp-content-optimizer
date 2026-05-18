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

The browser UI (`src/public/index.html`) provides a dashboard with four tabs:

| Tab | Description |
|---|---|
| **Dashboard** | Run any CLI command and stream its output live |
| **SEO Optimizer** | Review all posts with low SEO scores, generate AI fixes per field, apply in bulk |
| **Media Optimizer** | See images with missing alt text, generate AI alt texts, apply in bulk |
| **H1 Overview** | Review and fix H1 headings and keyphrases across all content |

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
