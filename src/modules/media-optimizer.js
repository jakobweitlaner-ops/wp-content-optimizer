import { getMedia, updateMedia } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';
import pLimit from 'p-limit';

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

export async function auditMedia({ output, fix = false } = {}) {
  log.header('Media Audit');
  log.info('Fetching media library...');

  const media = await getMedia({ media_type: 'image' });
  log.info(`Analyzing ${media.length} images...`);

  const results = [];
  let issueCount = 0;

  for (const item of media) {
    const issues = auditMediaItem(item);
    if (issues.length > 0) {
      issueCount += issues.length;
      results.push({
        id: item.id,
        filename: item.slug,
        url: item.source_url,
        altText: item.alt_text || null,
        fileSize: item.media_details?.filesize || null,
        width: item.media_details?.width || null,
        height: item.media_details?.height || null,
        issues,
      });
    }
  }

  if (results.length === 0) {
    log.success('All media items look good.');
  } else {
    log.warn(`Found ${issueCount} issue(s) in ${results.length} media item(s):`);
    for (const item of results) {
      log.row(item.filename.substring(0, 35), item.url, 'yellow');
      for (const issue of item.issues) {
        log.row('', `• ${issue}`, 'dim');
      }
    }
  }

  if (fix) {
    const missingAlt = results.filter((r) => r.issues.includes('Missing alt text'));

    if (missingAlt.length === 0) {
      log.info('No images with missing alt text to fix.');
    } else {
      const { generateAltText } = await import('../utils/claude.js');
      log.info(`\nGenerating alt text for ${missingAlt.length} image(s)...`);
      const limit = pLimit(3);
      let fixed = 0;

      await Promise.all(
        missingAlt.map((item) =>
          limit(async () => {
            try {
              const altText = await generateAltText(item.url);
              if (!altText) return;

              await updateMedia(item.id, { alt_text: altText });
              fixed++;
              log.row(item.filename.substring(0, 35), `Alt: "${altText.substring(0, 50)}…"`, 'green');
            } catch (err) {
              log.row(item.filename.substring(0, 35), `Error: ${err.message}`, 'red');
            }
          })
        )
      );

      log.success(`Fixed alt text for ${fixed}/${missingAlt.length} images.`);
    }
  }

  if (output) saveReport(output, { summary: { total: media.length, withIssues: results.length, totalIssues: issueCount }, results });

  return results;
}
