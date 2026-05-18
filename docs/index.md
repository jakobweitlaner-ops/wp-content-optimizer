# WP Content Optimizer — Documentation

> Node.js CLI + Web UI tool for optimizing WordPress content: broken link detection, SEO auditing, media quality checks, and AI-powered fix suggestions.

## Table of Contents

- [Quick Start](configuration.md)
- [CLI Reference](cli-reference.md)
- [Web UI & REST API](web-ui.md)
- [Architecture](architecture.md)
- [Modules](modules.md)
- [AI Features](ai-features.md)
- [Changelog](changelog.md)

---

## What This Tool Does

| Feature | How to use |
|---|---|
| Test WordPress connection | `node src/cli.js test-connection` |
| Find broken external links | `node src/cli.js check-links` |
| Audit SEO scores | `node src/cli.js audit-seo` |
| Audit media / images | `node src/cli.js audit-media` |
| AI site health report | `node src/cli.js get-status` |
| Interactive Web UI | `npm run ui` → http://localhost:3000 |

---

## Requirements

- Node.js >= 18
- WordPress with REST API enabled
- WordPress Application Password ([how to create one](configuration.md#application-password))
- Optional: Anthropic API key for AI features

---

## Installation

```bash
git clone https://github.com/jakobweitlaner-ops/wp-content-optimizer
cd wp-content-optimizer
npm install
cp .env.example .env
# Edit .env with your WordPress credentials
```

See [Configuration](configuration.md) for all environment variables.

---

## Documentation Updates

This documentation is automatically kept in sync with the source code.
Every push to `main` that changes files in `src/`, `package.json`, or `.env.example`
triggers the [sync-docs workflow](../.github/workflows/sync-docs.yml), which runs
`scripts/sync-docs.js` and commits any changed documentation files.

To update docs manually:

```bash
node scripts/sync-docs.js
```
