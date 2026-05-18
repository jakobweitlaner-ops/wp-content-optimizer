# Modules Reference

---

## `src/modules/link-checker.js`

### `checkLinks({ concurrency, output })`

Fetches all posts and pages, extracts external links, checks each URL, and reports broken ones.

- `concurrency` — number of parallel checks (default: `5`)
- `output` — optional file path to save JSON report

**Returns:** `{ brokenLinks, timeoutLinks }`

---

## `src/modules/seo-optimizer.js`

### `scoreSeo(post)`

Scores a single WP REST post object. Pure function — no network calls.

**Returns:** `{ score, issues, wordCount, h1Count, h2Count }`

### `auditSeoItems()`

Fetches all posts and pages, scores each, and returns a sorted array (worst first).
Each item includes all `scoreSeo` fields plus: `currentH1`, `currentIntro`, `currentYoastTitle`, `currentYoastDesc`, `currentKeyphrase`, `headingFormat`, `lang`, `isNoindex`.
Items with `isNoindex: true` are filtered out.

### `auditSeo({ minScore, aiSuggestions, output })`

CLI-facing audit function. Prints results to stdout and optionally saves a report.

**Returns:** array of scored post objects

### `generateSeoFixForItem(id, type, field, keyphrase)`

Generates an AI fix for a single field of a single post/page.
Valid fields: `title`, `excerpt`, `h1`, `intro`, `content`, `keyphrase`.
Requires `ANTHROPIC_API_KEY`.

### `previewSeoFixes({ minScore, onProgress, onError })`

Generates AI fix proposals (title + excerpt) for all posts below `minScore`.
Used by the Web UI's preview stream endpoint.

**Returns:** array of proposal objects `{ id, type, field, currentValue, proposedValue, ... }`

### `applySeoFixes(changes)`

Applies an array of `{ id, type, field, value }` changes to WordPress.
For `h1`, `intro`, and `content` fields: fetches raw content, patches it in-place (Gutenberg-aware), and writes back.
For `title`, `excerpt`, `keyphrase`: writes to Yoast meta fields.

**Returns:** array of `{ id, type, field, value, success, error? }`

### `applyBrandFix(id, type)`

Scans Yoast title, meta description, and post content for brand name misspellings and fixes them.

**Returns:** `{ fixed: string[] }` — list of field names that were updated

### `getSeoImageProposals(id, type, keyphrase)`

Finds all embedded images in a post, then calls Claude to generate keyphrase-aware alt texts.

**Returns:** array of `{ imageId, filename, currentAlt, proposedAlt }`

### `detectHeadingFormat(content)`

Utility — parses the first heading tag in HTML content.

**Returns:** `{ tag, classes, style, text, isH1, needsConversion }` or `null`

---

## `src/modules/media-optimizer.js`

### `auditMedia({ fix, output })`

Checks all images in the media library for issues. Optionally auto-fixes missing alt texts.

**Returns:** array of items with issues

### `previewMediaFixes()`

Returns rule-based (non-AI) alt text proposals for images missing alt text.
Uses image title or slug as the proposed text.

### `applyMediaFixes(changes)`

Applies `[{ id, altText }]` changes to WordPress media items.

**Returns:** `[{ id, altText, success, error? }]`

### `auditAltTextWithAI({ onProgress, onProposal, onError })`

Fetches all images, downloads each as base64, and asks Claude to evaluate and improve the alt text.
Uses visual analysis (`claude-haiku-4-5-20251001` with image input).
Processes images 3 at a time.

**Returns:** array of proposal objects with `currentAltText`, `proposedAltText`, `reason`

---

## `src/utils/wp-api.js`

Thin axios-based WordPress REST API client.

| Export | Description |
|---|---|
| `testConnection()` | GET `/users/me` — verifies credentials |
| `getSiteInfo()` | GET `/` — returns `{ name, description, url }` |
| `getSiteContext()` | Aggregates site info, page/post titles, categories for AI context |
| `getPosts(params?)` | Paginated fetch of all published posts |
| `getPages(params?)` | Paginated fetch of all published pages |
| `getPost(id, params?)` | Single post |
| `getPage(id, params?)` | Single page |
| `getMedia(params?)` | Paginated fetch of media library |
| `getMediaItem(id)` | Single media item |
| `updatePost(id, data)` | PUT post |
| `updatePage(id, data)` | PUT page |
| `updateMedia(id, data)` | PUT media item |

All requests use HTTP Basic authentication with the configured Application Password.

---

## `src/utils/claude-suggestions.js`

AI text generation helpers, all backed by `claude-haiku-4-5-20251001`.

| Export | Description |
|---|---|
| `detectLanguage(text)` | Heuristic language detection → ISO 639-1 code |
| `generateSeoFixes(post, issues, keyphrase?)` | Title and/or excerpt fixes |
| `generateKeyphrase(post)` | Suggest a 2–4 word focus keyphrase |
| `generateH1Fix(post, keyphrase?)` | Optimized H1 heading |
| `generateIntroFix(post, keyphrase)` | Rewritten or new introduction paragraph |
| `generateContentExtension(post, keyphrase?)` | Expanded version of all paragraphs |
| `generateImageAltWithKeyphrase(images, title, keyphrase)` | Keyphrase-aware alt texts |
| `getSeoSuggestions(post, issues)` | 2–3 short actionable suggestions (CLI `--ai`) |

---

## `src/utils/claude-status.js`

Implements the `get-status` agentic loop.

### `getSiteStatus({ seoResults, linkResults, mediaResults })`

Runs a Claude tool-use conversation with three tools:
- `get_seo_status` — returns score distribution and top issues
- `get_link_status` — returns broken link counts and examples
- `get_media_status` — returns media issue counts

Claude calls the tools it needs, then produces a markdown health report.

---

## `src/utils/content-normalizer.js`

Brand name correction and title normalisation utilities.

| Export | Description |
|---|---|
| `BRAND_NAME` | Canonical brand name string |
| `fixBrandName(text)` | Replaces misspelled brand name variants |
| `hasBrandIssue(text)` | Returns `true` if text contains a misspelling |
| `normalizeTitleSeparator(title)` | Replaces ` - `, ` – `, ` — ` with ` \| ` |
| `normalizeTitle(title)` | Applies separator + brand name normalisation |
| `normalizeText(text)` | Applies brand name normalisation only |

---

## `src/utils/logger.js`

Coloured terminal output and JSON report saving.

Key methods: `log.header`, `log.info`, `log.warn`, `log.success`, `log.error`, `log.row`, `saveReport`.
