# Configuration

All configuration is done via a `.env` file in the project root.

```bash
cp .env.example .env
# Edit .env with your values
```

---

## Required Variables

| Variable | Description | Example |
|---|---|---|
| `WP_URL` | WordPress site URL (no trailing slash) | `https://my-site.com` |
| `WP_USERNAME` | WordPress username | `admin` |
| `WP_APP_PASSWORD` | WordPress Application Password | `xxxx xxxx xxxx xxxx xxxx xxxx` |

### Application Password

Generate one in WordPress under **Users → Profile → Application Passwords**.
The generated password has the format `xxxx xxxx xxxx xxxx xxxx xxxx` (with spaces — keep them).

---

## Optional Variables

| Variable | Default | Description |
|---|---|---|
| `WP_INSECURE` | `false` | Set `true` to disable TLS certificate verification (for self-signed certs) |
| `CONCURRENCY` | `5` | Max concurrent HTTP requests for the link checker |
| `TIMEOUT` | `60000` | WordPress API request timeout in milliseconds |
| `LINK_TIMEOUT` | `20000` | Timeout per link check in milliseconds |
| `REPORTS_DIR` | `./reports` | Directory where JSON reports are saved |
| `ANTHROPIC_API_KEY` | *(none)* | Anthropic API key — required for all AI features |
| `SITE_TYPE` | *(none)* | Business type for AI context (e.g. `Apartmenthaus`, `Restaurant`) |
| `UI_PORT` | `3000` | Port for the Web UI server |

---

## AI Features

AI features require `ANTHROPIC_API_KEY`. Get a key at [console.anthropic.com](https://console.anthropic.com).

AI is used by:

- `audit-seo --ai` — generates SEO suggestions per post
- `get-status` — runs all audits and produces an AI health report
- Web UI: "AI Alt-Text", SEO fix previews, keyphrase generation, H1/intro/content fixes

The tool uses `claude-haiku-4-5-20251001` for all AI requests.

---

## Example `.env`

```env
WP_URL=https://your-wordpress-site.com
WP_USERNAME=your-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
WP_INSECURE=false
LINK_TIMEOUT=20000
ANTHROPIC_API_KEY=sk-ant-...
SITE_TYPE=Apartmenthaus
```
