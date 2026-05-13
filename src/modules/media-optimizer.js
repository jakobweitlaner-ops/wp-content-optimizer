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
