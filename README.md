# wp-content-optimizer

A Node.js CLI tool for optimizing WordPress content: broken link detection, SEO auditing, media quality checks, and AI-powered fix suggestions.

**Full documentation:** [docs/index.md](docs/index.md)

## Requirements

- Node.js >= 18
- WordPress with REST API enabled
- WordPress Application Password

## Installation

```bash
npm install
cp .env.example .env
# Fill in your WordPress credentials in .env
```

## Configuration

Edit `.env`:

```env
WP_URL=https://your-wordpress-site.com
WP_USERNAME=your-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

Generate an Application Password in WordPress under **Settings → Users → Application Passwords**.

## Usage

### Test connection

```bash
node src/cli.js test-connection
```

### Check for broken links

```bash
node src/cli.js check-links
node src/cli.js check-links --concurrency 10
node src/cli.js check-links --output reports/broken-links.json
```

### SEO audit

```bash
node src/cli.js audit-seo
node src/cli.js audit-seo --min-score 70
node src/cli.js audit-seo --output reports/seo-audit.json
```

SEO score breakdown (0–100):

| Check | Points |
|---|---|
| Title length (20–60 chars) | 25 |
| Single H1 heading | 20 |
| Word count (300+ / 600+) | 25 |
| H2 subheadings for long posts | 15 |
| Excerpt/meta description | 15 |

### Media audit

```bash
node src/cli.js audit-media
node src/cli.js audit-media --output reports/media-audit.json
```

Checks:
- Missing alt text
- Generic filenames (e.g. `image001`, `dsc_123`)
- File size > 200 KB
- Resolution > 2560×2560 px

## Documentation

See the [`docs/`](docs/) folder for full documentation:

- [CLI Reference](docs/cli-reference.md)
- [Web UI & REST API](docs/web-ui.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Modules Reference](docs/modules.md)
- [AI Features](docs/ai-features.md)
- [Changelog](docs/changelog.md)

Docs are automatically kept in sync with the source code via a GitHub Actions workflow
that runs on every push to `main`.
