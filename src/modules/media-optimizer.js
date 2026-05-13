import Anthropic from '@anthropic-ai/sdk';
import { getMedia, updateMedia } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';

const MAX_FILE_SIZE_BYTES = 200 * 1024; // 200 KB
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 2560;

function auditMediaItem(item) {
  const issues = [];

  // Alt text check
  if (!item.alt_text || item.alt_text.trim().length === 0) {
    issues.push('Missing alt text');
  }

  // Filename check (should be descriptive, not generic like image001.jpg)
  const filename = item.slug || '';
  if (/^(img|image|photo|pic|dsc|screenshot)[\-_]?\d+$/i.test(filename)) {
    issues.push(`Generic filename: "${filename}"`);
  }
  if (filename.length < 5) {
    issues.push(`Filename too short: "${filename}"`);
  }

  // File size check
  const fileSize = item.media_details?.filesize;
  if (fileSize && fileSize > MAX_FILE_SIZE_BYTES) {
    const kb = Math.round(fileSize / 1024);
    issues.push(`Large file size: ${kb} KB (max recommended: ${MAX_FILE_SIZE_BYTES / 1024} KB)`);
  }

  // Resolution check
  const width = item.media_details?.width;
  const height = item.media_details?.height;
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    issues.push(`High resolution: ${width}x${height}px (max recommended: ${MAX_WIDTH}x${MAX_HEIGHT})`);
  }

  return issues;
}

function generateAltText(item) {
  const title = item.title?.rendered?.trim();
  if (title && title.length > 3) return title;
  const slug = (item.slug || '').replace(/[-_]+/g, ' ').trim();
  return slug || 'image';
}

export async function previewMediaFixes() {
  const media = await getMedia({ media_type: 'image' });
  const proposals = [];

  for (const item of media) {
    const issues = auditMediaItem(item);
    const missingAlt = issues.find((i) => i === 'Missing alt text');
    if (missingAlt) {
      proposals.push({
        id: item.id,
        filename: item.slug,
        url: item.source_url,
        currentAltText: item.alt_text || '',
        proposedAltText: generateAltText(item),
      });
    }
  }

  return proposals;
}

export async function applyMediaFixes(ids) {
  const media = await getMedia({ media_type: 'image' });
  const results = [];

  for (const item of media) {
    if (!ids.includes(item.id)) continue;
    const altText = generateAltText(item);
    try {
      await updateMedia(item.id, { alt_text: altText });
      results.push({ id: item.id, filename: item.slug, altText, success: true });
    } catch (err) {
      results.push({ id: item.id, filename: item.slug, error: err.message, success: false });
    }
  }

  return results;
}

async function promisePool(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export async function auditAltTextWithAI({ onProgress, onProposal } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });
  const media = await getMedia({ media_type: 'image' });
  const proposals = [];
  let done = 0;

  const tasks = media.map((item) => async () => {
    const altText = item.alt_text?.trim() || '';
    done++;
    if (onProgress) onProgress(done, media.length, item.slug);

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: item.source_url } },
            {
              type: 'text',
              text: `Current alt text: "${altText || '(empty)'}"\n\nEvaluate this alt text for the image. Reply with JSON only:\n{"quality":"good"|"poor","reason":"one sentence","suggestion":"improved alt text or null"}`,
            },
          ],
        }],
      });

      const text = response.content[0]?.text || '';
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return;
      const json = JSON.parse(match[0]);

      if (json.quality === 'poor' && json.suggestion) {
        const proposal = {
          id: item.id,
          filename: item.slug,
          url: item.source_url,
          currentAltText: altText,
          proposedAltText: json.suggestion,
          reason: json.reason || '',
        };
        proposals.push(proposal);
        if (onProposal) onProposal(proposal);
      }
    } catch {
      // skip failed items
    }
  });

  await promisePool(tasks, 3);
  return proposals;
}

export async function auditMedia({ fix = false, output } = {}) {
  log.header('Media Audit');
  log.info('Fetching media library...');

  const media = await getMedia({ media_type: 'image' });
  log.info(`Analyzing ${media.length} images...`);

  const results = [];
  let issueCount = 0;
  let fixedCount = 0;
  let checked_count = 0;

  for (const item of media) {
    checked_count++;
    process.stdout.write(`\r  Analyzing ${checked_count}/${media.length}...`);
    const issues = auditMediaItem(item);
    if (issues.length > 0) {
      issueCount += issues.length;

      const fixedIssues = [];
      if (fix) {
        const missingAlt = issues.find((i) => i === 'Missing alt text');
        if (missingAlt) {
          const altText = generateAltText(item);
          try {
            await updateMedia(item.id, { alt_text: altText });
            fixedIssues.push(`Set alt text: "${altText}"`);
            fixedCount++;
          } catch (err) {
            fixedIssues.push(`Failed to set alt text: ${err.message}`);
          }
        }
      }

      results.push({
        id: item.id,
        filename: item.slug,
        url: item.source_url,
        altText: item.alt_text || null,
        fileSize: item.media_details?.filesize || null,
        width: item.media_details?.width || null,
        height: item.media_details?.height || null,
        issues,
        ...(fixedIssues.length > 0 ? { fixed: fixedIssues } : {}),
      });
    }
  }

  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  if (results.length === 0) {
    log.success('All media items look good.');
  } else {
    log.warn(`Found ${issueCount} issue(s) in ${results.length} media item(s):`);
    for (const item of results) {
      log.row(item.filename.substring(0, 35), item.url, 'yellow');
      for (const issue of item.issues) {
        log.row('', `• ${issue}`, 'dim');
      }
      if (item.fixed) {
        for (const f of item.fixed) {
          log.row('', `✔ ${f}`, 'green');
        }
      }
    }
  }

  if (fix && fixedCount > 0) {
    log.success(`Auto-fixed ${fixedCount} missing alt text(s).`);
  }

  if (output) saveReport(output, {
    summary: { total: media.length, withIssues: results.length, totalIssues: issueCount, autoFixed: fixedCount },
    results,
  });

  return results;
}
