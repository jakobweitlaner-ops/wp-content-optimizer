# AI Features

All AI features require an Anthropic API key set as `ANTHROPIC_API_KEY` in `.env`.

---

## CLI: `audit-seo --ai`

Adds 2–3 short improvement suggestions after each post in the SEO audit output.

```bash
node src/cli.js audit-seo --ai
```

Uses `getSeoSuggestions()` in `claude-suggestions.js`. Suggestions are printed but not saved to WordPress.

---

## CLI: `get-status`

Runs all three audits in parallel, then uses Claude with **tool use** to produce a health report.

```bash
node src/cli.js get-status
```

Claude calls internal tools (`get_seo_status`, `get_link_status`, `get_media_status`) to query the audit results and produces a markdown report with:
- Overall status: 🟢 Healthy / 🟡 Needs Attention / 🔴 Critical
- Key metrics per area
- Top 3 prioritized action items

---

## Web UI: SEO Fixes

In the **SEO Optimizer** tab, click **"AI Fix"** next to any field to generate an AI suggestion.

Supported fields per post/page:

| Field | What Claude generates |
|---|---|
| Yoast SEO title | Improved title, 20–60 chars, keeps structural pattern (e.g. `Page \| Brand`) |
| Meta description | Compelling summary, 120–140 chars |
| Focus keyphrase | 2–4 word phrase, search-intent aligned |
| H1 heading | Descriptive heading, different from the SEO title where possible |
| Introduction paragraph | 40–80 word intro with keyphrase in first/second sentence |
| Content expansion | All paragraphs rewritten to ~1.5–2× their original length |

All fixes are generated in the **detected language** of the content (German, French, Spanish, Italian, or English).

Fixes are shown as proposals — you review them in the UI before applying.

---

## Web UI: AI Alt-Text

In the **Media Optimizer** tab, click **"AI Alt-Text Analysis"** to run visual analysis on all images.

Claude receives each image as base64 and evaluates:
- Is the current alt text accurate and descriptive?
- If not, generates an improved German-language alt text

Proposals that score `"poor"` are shown with the reason and suggested replacement.

---

## Web UI: Image Alt with Keyphrase

In the **SEO Optimizer** tab, for any post with a keyphrase set, a button shows all images embedded in that post and generates alt texts that naturally weave in words from the keyphrase.

---

## Language Detection

Claude is always prompted to write in the language of the post content.
The `detectLanguage()` function uses two-criteria matching (common words + language-specific characters) to detect German, French, Spanish, Italian, and English.

For short texts, the WordPress/Yoast `og_locale` field is used as a fallback.

---

## Model

All AI features use **`claude-haiku-4-5-20251001`** for fast, cost-efficient responses.

To change the model, update the `model` parameter in:
- `src/utils/claude-suggestions.js` (all text generation)
- `src/modules/media-optimizer.js` (visual alt-text analysis)
- `src/utils/claude-status.js` (site health report)
