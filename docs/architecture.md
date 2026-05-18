# Architecture

## Overview

```
wp-content-optimizer/
├── src/
│   ├── cli.js                  # CLI entry point (commander)
│   ├── server.js               # Express web server + REST API
│   ├── modules/
│   │   ├── link-checker.js     # Broken link detection
│   │   ├── seo-optimizer.js    # SEO scoring, fix generation, fix application
│   │   └── media-optimizer.js  # Media audit, AI alt-text generation
│   ├── utils/
│   │   ├── wp-api.js           # WordPress REST API client (axios)
│   │   ├── claude-suggestions.js # AI text generation (Anthropic SDK)
│   │   ├── claude-status.js    # AI health report via tool use
│   │   ├── content-normalizer.js # Brand name correction, title normalisation
│   │   └── logger.js           # Coloured console output, JSON report saving
│   └── public/
│       └── index.html          # Single-page Web UI (vanilla JS)
├── tests/
│   ├── link-checker.test.js
│   ├── seo-optimizer.test.js
│   └── media-optimizer.test.js
├── scripts/
│   └── sync-docs.js            # Regenerates docs from source (run in CI)
├── docs/                       # This documentation
├── .github/workflows/
│   └── sync-docs.yml           # Auto-updates docs on push to main
└── wp-optimizer-yoast-rest.php # WordPress plugin: exposes Yoast fields via REST
```

---

## Data Flow

### CLI command

```
User → cli.js → module function → wp-api.js (fetch data)
                                → claude-suggestions.js (optional AI)
                                → logger.js (output) / saveReport (JSON)
```

### Web UI request (fix workflow)

```
Browser → server.js endpoint
        → seo-optimizer.js or media-optimizer.js
             → wp-api.js (read post)
             → claude-suggestions.js (generate fix)
        → wp-api.js (write fix back to WordPress)
        → SSE stream → Browser
```

---

## WordPress REST API Usage

The tool uses the WP REST API v2 (`/wp-json/wp/v2`):

| Endpoint | Usage |
|---|---|
| `GET /posts` | Fetch all published posts (with `context=edit` for raw content) |
| `GET /pages` | Fetch all published pages |
| `GET /media` | Fetch image library |
| `GET /posts/{id}` | Fetch single post for fix generation |
| `PUT /posts/{id}` | Write back SEO fixes |
| `PUT /pages/{id}` | Write back SEO fixes |
| `PUT /media/{id}` | Write back alt text |
| `GET /users/me` | Test connection |

Authentication is HTTP Basic with a WordPress Application Password.

---

## WordPress Plugin (`wp-optimizer-yoast-rest.php`)

The optional PHP plugin extends the REST API to expose Yoast SEO fields that are otherwise not included in the default WP REST response:

- `_yoast_wpseo_title` (Yoast SEO title)
- `_yoast_wpseo_metadesc` (Yoast meta description)
- `_yoast_wpseo_focuskw` (focus keyphrase)
- `_yoast_wpseo_meta-robots-noindex` (noindex flag)

Install by uploading the file to `wp-content/plugins/` and activating it.

---

## AI Integration

All AI calls use the [Anthropic Node.js SDK](https://github.com/anthropic-ai/anthropic-sdk-node).

| Feature | Model | Input | Output |
|---|---|---|---|
| SEO suggestions (CLI `--ai`) | claude-haiku-4-5-20251001 | title, excerpt, word count, issues | Array of suggestion strings |
| Title / excerpt fix | claude-haiku-4-5-20251001 | title, content snippet, issues | `{ title, excerpt }` JSON |
| H1 fix | claude-haiku-4-5-20251001 | title, current H1, content | `{ h1 }` JSON |
| Intro fix | claude-haiku-4-5-20251001 | title, current intro, body | `{ intro }` JSON |
| Content expansion | claude-haiku-4-5-20251001 | all paragraphs, word count | Array of expanded paragraphs |
| Keyphrase generation | claude-haiku-4-5-20251001 | title, content | `{ keyphrase }` JSON |
| Image alt text (visual) | claude-haiku-4-5-20251001 | base64 image, site context | `{ quality, reason, suggestion }` JSON |
| Image alt with keyphrase | claude-haiku-4-5-20251001 | image list, post title, keyphrase | Array of `{ id, alt }` |
| Site health report | claude-haiku-4-5-20251001 | tool use results | Markdown report |

The `get-status` command uses the **tool use** pattern: Claude drives an agentic loop calling `get_seo_status`, `get_link_status`, and `get_media_status` before producing the final report.

---

## Language Detection

`claude-suggestions.js` includes a heuristic language detector (`detectLanguage`) that examines the first 800 characters of combined title + content text. It matches common function words AND language-specific characters (umlauts, accents) to distinguish German, French, Spanish, Italian, and English. All AI prompts instruct Claude to write exclusively in the detected language.

---

## Content Patching

When applying H1 or intro fixes, `seo-optimizer.js` must edit raw WordPress HTML without breaking Gutenberg block structure. The patching logic handles three cases:

1. **UAGB Advanced Heading block** — updates `headingTag` attribute in the block JSON + replaces the HTML tag in-place
2. **Standard Gutenberg `wp:heading` block** — replaces the entire block comment + HTML with `{"level":1}`
3. **Classic HTML** — simple regex tag replacement

For intro fixes (first paragraph after the heading), the same three-path approach handles `wp:paragraph` blocks and classic `<p>` tags.
