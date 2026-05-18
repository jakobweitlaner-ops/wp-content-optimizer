#!/usr/bin/env node
/**
 * Regenerates auto-generated sections in docs/ from the current source code.
 *
 * Sections are delimited by HTML comments:
 *   <!-- AUTO-GENERATED SECTION: <name> -->
 *   ...content...
 *   <!-- END AUTO-GENERATED SECTION: <name> -->
 *
 * Run manually:  node scripts/sync-docs.js
 * Run in CI:     triggered by .github/workflows/sync-docs.yml
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── helpers ──────────────────────────────────────────────────────────────────

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function write(relPath, content) {
  writeFileSync(join(ROOT, relPath), content, 'utf8');
}

function replaceSection(fileContent, sectionName, newContent) {
  const open = `<!-- AUTO-GENERATED SECTION: ${sectionName} -->`;
  const close = `<!-- END AUTO-GENERATED SECTION: ${sectionName} -->`;
  const re = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`, 'm');
  const replacement = `${open}\n${newContent.trim()}\n${close}`;
  if (!re.test(fileContent)) {
    console.warn(`  ⚠  Section "${sectionName}" not found — skipping`);
    return fileContent;
  }
  return fileContent.replace(re, replacement);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getVersion() {
  const pkg = JSON.parse(read('package.json'));
  return pkg.version;
}

function gitLog(n = 20) {
  try {
    return execSync(`git -C "${ROOT}" log --oneline -${n}`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── changelog entry from recent git commits ───────────────────────────────────

function buildChangelogEntry() {
  const version = getVersion();
  const date = today();
  const log = gitLog(20);
  if (!log.trim()) return null;

  // Group commits by type prefix (feat, fix, docs, refactor, chore, etc.)
  const lines = log.trim().split('\n').map(l => l.replace(/^[a-f0-9]+ /, '').trim());
  const added = [];
  const changed = [];
  const fixed = [];
  const other = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^(feat|add|new)[:(]/.test(lower) || lower.startsWith('feat') || lower.startsWith('add ')) {
      added.push(line);
    } else if (/^(fix|bug)[:(]/.test(lower) || lower.startsWith('fix ')) {
      fixed.push(line);
    } else if (/^(refactor|perf|improve|update|change)[:(]/.test(lower)) {
      changed.push(line);
    } else if (!/^(docs|chore|ci|test|style)[:(]/.test(lower)) {
      other.push(line);
    }
  }

  const sections = [];
  if (added.length) sections.push(`### Added\n${added.map(l => `- ${l}`).join('\n')}`);
  if (changed.length) sections.push(`### Changed\n${changed.map(l => `- ${l}`).join('\n')}`);
  if (fixed.length) sections.push(`### Fixed\n${fixed.map(l => `- ${l}`).join('\n')}`);
  if (other.length) sections.push(`### Other\n${other.map(l => `- ${l}`).join('\n')}`);

  if (sections.length === 0) return null;
  return `## [${version}] — ${date}\n\n${sections.join('\n\n')}`;
}

// ── update changelog ─────────────────────────────────────────────────────────

function updateChangelog() {
  const entry = buildChangelogEntry();
  if (!entry) {
    console.log('  changelog: no new commits to add');
    return;
  }

  let content = read('docs/changelog.md');
  const existingDate = today();

  // Don't duplicate an entry for the same date
  if (content.includes(`— ${existingDate}`)) {
    console.log(`  changelog: entry for ${existingDate} already exists — skipping`);
    return;
  }

  // Insert after the AUTO-GENERATED SECTION open comment
  const marker = '<!-- AUTO-GENERATED SECTION: changelog -->';
  content = content.replace(marker, `${marker}\n\n${entry}`);
  write('docs/changelog.md', content);
  console.log(`  changelog: added entry for v${getVersion()} (${existingDate})`);
}

// ── update index.md (version badge) ──────────────────────────────────────────

function updateIndex() {
  const version = getVersion();
  let content = read('docs/index.md');
  // Replace version mention in the header line if present
  const updated = content.replace(
    /\*\*Version:\*\* `[\d.]+`/,
    `**Version:** \`${version}\``
  );
  if (updated !== content) {
    write('docs/index.md', updated);
    console.log(`  index.md: updated version to ${version}`);
  } else {
    console.log('  index.md: no version badge found — skipping');
  }
}

// ── extract env vars from .env.example ───────────────────────────────────────

function buildEnvTable() {
  const raw = read('.env.example');
  const rows = [];
  let currentComment = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      currentComment = trimmed.replace(/^#\s*/, '');
      continue;
    }
    if (!trimmed || !trimmed.includes('=')) {
      currentComment = '';
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    const defaultVal = rest.join('=').replace(/^"|"$/, '') || '*(none)*';
    rows.push(`| \`${key.trim()}\` | \`${defaultVal}\` | ${currentComment} |`);
    currentComment = '';
  }
  return '| Variable | Default | Description |\n|---|---|---|\n' + rows.join('\n');
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log('sync-docs: running...');

updateChangelog();
updateIndex();

console.log('sync-docs: done.');
