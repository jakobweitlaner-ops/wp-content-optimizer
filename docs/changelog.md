# Changelog

<!-- AUTO-GENERATED SECTION: changelog -->

## [1.0.0] — 2026-05-21

### Added
- feat: KI-Übersetzung von Seiten und Beiträgen mit HTML-Struktur-Beibehaltung

### Fixed
- fix: Bestehende Übersetzungen standardmäßig deaktiviert – Original nie überschrieben
- fix: Polylang-Integration für HTML-Übersetzung – neue Drafts statt Überschreiben
- fix: Retry-Logik für Bild-Management-Ladeprobleme verbessern
- fix: Dateinamen statt Titel im Mediathek-Picker anzeigen
- fix: Bild-URL nicht im Inhalt gefunden – contentSrc für Ersetzung verwenden
- fix: Größenvarianten im Bild-Management deduplizieren
- fix: mobile srcset-Varianten beim Bildaustausch korrekt erhalten
- fix: SSE keep-alive heartbeat verhindert Proxy-Timeout im Bild-Management
- fix: Größenvarianten-Mismatch bei Bildaustausch (Bild-URL nicht im Inhalt gefunden)
- fix: Bildaustausch aktualisiert nur die aktuelle Seite, nicht alle anderen

### Other
- Merge pull request #125 from jakobweitlaner-ops/claude/translate-html-content-dKT8h
- Merge pull request #123 from jakobweitlaner-ops/claude/fix-image-management-loading-1h7hF
- Merge pull request #122 from jakobweitlaner-ops/claude/fix-image-management-loading-1h7hF
- Merge pull request #121 from jakobweitlaner-ops/claude/fix-image-management-loading-1h7hF
- Merge pull request #120 from jakobweitlaner-ops/claude/fix-image-management-loading-1h7hF
- Merge pull request #119 from jakobweitlaner-ops/claude/fix-image-management-loading-1h7hF
- Merge pull request #118 from jakobweitlaner-ops/claude/fix-image-management-loading-1h7hF
- Merge pull request #117 from jakobweitlaner-ops/claude/fix-mobile-image-links-pOG1U
- Merge pull request #116 from jakobweitlaner-ops/claude/fix-mobile-image-links-pOG1U

## [1.0.0] — 2026-05-20

### Added
- feat: bereits gut benannte Bilder nach unten sortieren bei erneuter Analyse
- feat: KI-gestützte Umbenennung von WordPress-Bilddateinamen
- feat: Bildaustausch – Übersetzungen gruppiert, Menüpunkt umbenannt
- feat: add repair-references to fix existing broken image URLs in posts

### Changed
- refactor: Dateinamen-Umbenennung als Einzelbild-Kartenansicht

### Fixed
- fix: 503-Fehler beim Umbenennen durch Retry-Logik mit Backoff beheben
- fix: Bild Management Timeout durch progressives SSE-Streaming behoben
- fix: Bild Management aktualisiert jetzt auch Block-ID und srcset-URLs
- fix: Gutenberg-Block-IDs und wp-image-Klassen nach Umbenennung aktualisieren
- fix: Umbenennen-Button war wegen doppelter Anführungszeichen im onclick-Attribut nicht klickbar
- fix: Menüpunkt von "Bildaustausch" in "Bild Management" umbenennen
- fix: fetch all Polylang language variants when updating post references
- fix: rename thumbnails by size_name match, not basename equality

### Other
- Merge pull request #101 from jakobweitlaner-ops/claude/wordpress-image-filenames-RAWXd
- Merge pull request #100 from jakobweitlaner-ops/claude/wordpress-image-filenames-RAWXd
- Merge pull request #99 from jakobweitlaner-ops/claude/wordpress-image-filenames-RAWXd
- Merge pull request #98 from jakobweitlaner-ops/claude/wordpress-image-filenames-RAWXd
- Merge pull request #97 from jakobweitlaner-ops/claude/rename-images-organize-pages-uTrhg
- Merge pull request #96 from jakobweitlaner-ops/claude/fix-thumbnail-scaled-rename
- Merge pull request #95 from jakobweitlaner-ops/claude/fix-thumbnail-scaled-rename

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
