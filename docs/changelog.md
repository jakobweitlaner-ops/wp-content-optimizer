# Changelog

<!-- AUTO-GENERATED SECTION: changelog -->

## [1.0.0] — 2026-05-19

### Added
- Add seasonal image replacement feature
- feat: editable H1 fields in overview + bulk brand fix + button readability

### Fixed
- Fix seasonal image proxy: add error logging, fallback to direct URL on proxy failure
- Fix proxy for external content images: route by origin
- Fix: seasonal cards collapsed by flex-shrink — add flex-shrink:0
- Fix seasonal image display via server-side proxy and DOM cleanup
- Fix seasonal view: resolve featured image URLs, dedup, broken img fallback
- fix: use Yoast og_locale as language fallback for short-content pages

### Other
- Merge pull request #84 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Merge pull request #83 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Merge pull request #82 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Merge pull request #81 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Debug & fix seasonal: include[] params, visible placeholders, count badges
- Merge pull request #80 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Merge pull request #79 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Merge pull request #78 from jakobweitlaner-ops/claude/seasonal-image-replacement-RFWPC
- Merge pull request #77 from jakobweitlaner-ops/claude/add-tool-documentation-OtDfp
- Merge pull request #76 from jakobweitlaner-ops/claude/check-heading-format-Lp7jB
- Merge pull request #75 from jakobweitlaner-ops/claude/check-heading-format-Lp7jB
<!-- New entries are prepended automatically by scripts/sync-docs.js on every push to main. -->

## [Unreleased]

## [1.0.0] — 2026-05-18

### Added
- CLI commands: `test-connection`, `check-links`, `audit-seo`, `audit-media`, `get-status`
- Web UI with SEO Optimizer, Media Optimizer, and H1 Overview tabs
- AI-powered SEO fix generation (title, excerpt, keyphrase, H1, intro, content expansion)
- AI-powered alt-text analysis using Claude vision
- AI site health report via Claude tool use (`get-status`)
- Gutenberg-aware H1 and intro patching (UAGB, standard `wp:heading`, classic HTML)
- Language detection for German, French, Spanish, Italian, and English content
- Brand name correction utility (`content-normalizer.js`)
- Yoast SEO field support via REST API plugin (`wp-optimizer-yoast-rest.php`)
- Noindex management via Web UI
- JSON report export for all CLI audits
- Keyphrase-aware image alt text generation
<!-- END AUTO-GENERATED SECTION: changelog -->
