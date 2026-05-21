#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { checkLinks } from './modules/link-checker.js';
import { auditSeo } from './modules/seo-optimizer.js';
import { auditMedia, compressOversizedImages, repairPostReferences, auditFilenamesWithAI, applyFilenameRenames } from './modules/media-optimizer.js';
import { testConnection } from './utils/wp-api.js';
import { log } from './utils/logger.js';
import { getSiteStatus } from './utils/claude-status.js';

const program = new Command();

program
  .name('wp-optimizer')
  .description('WordPress Content Optimizer CLI')
  .version('1.0.0');

program
  .command('test-connection')
  .description('Test connection to WordPress REST API')
  .action(async () => {
    try {
      await testConnection();
    } catch (err) {
      log.error(`Connection failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('check-links')
  .description('Find broken links (404) across all posts and pages')
  .option('-c, --concurrency <number>', 'Number of concurrent requests', '5')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      const concurrency = parseInt(options.concurrency, 10);
      await checkLinks({ concurrency, output: options.output });
    } catch (err) {
      log.error(`Link check failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('audit-seo')
  .description('Audit SEO quality of all posts and pages (score 0-100)')
  .option('--min-score <number>', 'Only show posts below this score', '80')
  .option('--ai', 'Add AI-powered suggestions via Claude API (requires ANTHROPIC_API_KEY)')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      const minScore = parseInt(options.minScore, 10);
      await auditSeo({ minScore, aiSuggestions: !!options.ai, output: options.output });
    } catch (err) {
      log.error(`SEO audit failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('audit-media')
  .description('Audit media files for missing alt texts, large sizes, bad filenames')
  .option('--fix', 'Auto-fix missing alt texts using image title/filename')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      await auditMedia({ fix: !!options.fix, output: options.output });
    } catch (err) {
      log.error(`Media audit failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('compress-images')
  .description('Detect and compress oversized images in the media library')
  .option('--threshold <kb>', 'File size threshold in KB – images above this are compressed (default: 200)', '200')
  .option('--target-size <kb>', 'Compress each image to at most this size in KB (e.g. 200); takes precedence over --quality')
  .option('--quality <number>', 'Fallback JPEG/WebP quality 1-100 when --target-size is not set (default: 82)', '82')
  .option('--max-width <px>', 'Maximum image width in pixels (default: 2560)', '2560')
  .option('--max-height <px>', 'Maximum image height in pixels (default: 2560)', '2560')
  .option('--dry-run', 'Only list oversized images without compressing')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      const threshold   = parseInt(options.threshold, 10) * 1024;
      const targetSizeKb = options.targetSize ? parseInt(options.targetSize, 10) : null;
      const quality     = parseInt(options.quality, 10);
      const maxWidth    = parseInt(options.maxWidth, 10);
      const maxHeight   = parseInt(options.maxHeight, 10);
      const dryRun      = !!options.dryRun;

      log.header('Image Compression');
      if (dryRun) log.info('Dry run – no images will be changed.');
      const modeLabel = targetSizeKb ? `Target: ≤${targetSizeKb} KB` : `Quality: ${quality}`;
      log.info(`Threshold: ${options.threshold} KB | ${modeLabel} | Max: ${maxWidth}x${maxHeight}px`);
      log.info('Scanning media library...');

      let totalSaved = 0;
      const results = await compressOversizedImages({
        threshold,
        targetSizeKb,
        quality,
        maxWidth,
        maxHeight,
        dryRun,
        onProgress: (done, total, slug) =>
          process.stdout.write(`\r  Processing ${done}/${total}: ${slug.substring(0, 30)}...`),
        onResult: (r) => {
          process.stdout.write('\r' + ' '.repeat(50) + '\r');
          if (r.dryRun) {
            log.row(r.filename.substring(0, 35), `${r.sizeKb} KB – would compress`, 'yellow');
          } else {
            const saved = Math.round(r.savings / 1024);
            totalSaved += r.savings;
            log.row(
              r.filename.substring(0, 35),
              `${Math.round(r.originalSize / 1024)} KB → ${Math.round(r.compressedSize / 1024)} KB (−${r.savingsPercent}%)`,
              'green',
            );
            log.row('', `New URL: ${r.newUrl}`, 'dim');
          }
        },
        onRefsUpdated: (count) => {
          if (count > 0) log.info(`Updated ${count} post/page(s) with changed image URLs.`);
        },
        onError: (slug, msg) => {
          process.stdout.write('\r' + ' '.repeat(50) + '\r');
          log.row(slug.substring(0, 35), `Error: ${msg}`, 'red');
        },
      });

      process.stdout.write('\r' + ' '.repeat(50) + '\r');

      if (results.length === 0) {
        log.success(`No oversized images found (threshold: ${options.threshold} KB).`);
      } else if (dryRun) {
        log.warn(`Found ${results.length} oversized image(s). Run without --dry-run to compress.`);
      } else {
        const ok = results.filter((r) => r.success).length;
        log.success(`Compressed ${ok}/${results.length} image(s). Total saved: ${Math.round(totalSaved / 1024)} KB.`);
      }

      if (options.output) {
        const { saveReport } = await import('./utils/logger.js');
        saveReport(options.output, { threshold: options.threshold, quality, dryRun, results });
      }
    } catch (err) {
      log.error(`Image compression failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('rename-images')
  .description('AI-powered analysis and renaming of image filenames (requires ANTHROPIC_API_KEY)')
  .option('--dry-run', 'Show proposals only – no images are changed')
  .option('-o, --output <file>', 'Save report as JSON')
  .action(async (options) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        log.error('ANTHROPIC_API_KEY is required for rename-images');
        process.exit(1);
      }

      log.header('Image Filename Renaming');
      if (options.dryRun) log.info('Dry run – no images will be changed.');
      log.info('Scanning media library with AI analysis…');

      const proposals = await auditFilenamesWithAI({
        onProgress: (done, total, slug) =>
          process.stdout.write(`\r  Analysing ${done}/${total}: ${slug.substring(0, 30)}...`),
        onError: (slug, msg) => log.row(slug, `Error: ${msg}`, 'red'),
      });
      process.stdout.write('\r' + ' '.repeat(60) + '\r');

      if (proposals.length === 0) {
        log.success('All filenames look good — nothing to do.');
        return;
      }

      log.warn(`${proposals.length} image(s) with improvable filenames:`);
      for (const p of proposals) {
        log.row(p.currentFilename.substring(0, 35), `→ ${p.proposedFilename}`, 'yellow');
        log.row('', p.reason, 'dim');
      }

      if (options.dryRun) {
        log.info('Dry run complete. Run without --dry-run to apply the renames.');
        if (options.output) {
          const { saveReport } = await import('./utils/logger.js');
          saveReport(options.output, { dryRun: true, proposals });
        }
        return;
      }

      log.info('Applying renames…');
      const changes = proposals.map((p) => ({ id: p.id, newFilename: p.proposedFilename }));
      let totalOk = 0;

      const { results, refsUpdated, featuredUpdated } = await applyFilenameRenames(changes, {
        onProgress: (done, total, slug) =>
          process.stdout.write(`\r  Processing ${done}/${total}: ${slug.substring(0, 30)}...`),
        onResult: (r) => {
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
          log.row(r.originalFilename.substring(0, 35), `→ ${r.newFilename}`, 'green');
          totalOk++;
        },
        onError: (slug, msg) => {
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
          log.row(slug.substring(0, 35), `Error: ${msg}`, 'red');
        },
      });
      process.stdout.write('\r' + ' '.repeat(60) + '\r');

      if (refsUpdated > 0) log.info(`Image URLs updated in ${refsUpdated} post(s)/page(s).`);
      if (featuredUpdated > 0) log.info(`Featured image updated in ${featuredUpdated} post(s)/page(s).`);
      log.success(`${totalOk}/${proposals.length} image(s) successfully renamed.`);

      if (options.output) {
        const { saveReport } = await import('./utils/logger.js');
        saveReport(options.output, { results, refsUpdated, featuredUpdated });
      }
    } catch (err) {
      log.error(`Rename failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('get-status')
  .description('AI-powered site health report using Claude tool use (requires ANTHROPIC_API_KEY)')
  .option('-c, --concurrency <number>', 'Concurrency for link checker', '5')
  .action(async (options) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        log.error('ANTHROPIC_API_KEY is required for get-status');
        process.exit(1);
      }

      const concurrency = parseInt(options.concurrency, 10);

      log.header('Site Status');
      log.info('Running all audits in parallel...');

      const [seoSettled, linkSettled, mediaSettled] = await Promise.allSettled([
        auditSeo({ minScore: 80, aiSuggestions: false }),
        checkLinks({ concurrency }),
        auditMedia({ fix: false }),
      ]);

      const seoResults = seoSettled.status === 'fulfilled' ? seoSettled.value : null;
      const linkResults = linkSettled.status === 'fulfilled' ? linkSettled.value : null;
      const mediaResults = mediaSettled.status === 'fulfilled' ? mediaSettled.value : null;

      log.info('Analyzing results with Claude...');
      log.info(`API key present: ${!!process.env.ANTHROPIC_API_KEY}`);
      log.info(`Base URL: ${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com (default)'}`);
      log.info(`Node version: ${process.version}`);
      const report = await getSiteStatus({ seoResults, linkResults, mediaResults });
      console.log('\x1b[0m__REPORT_START__');
      console.log(report);
      console.log('__REPORT_END__');
    } catch (err) {
      log.error(`Status check failed: ${err.message}`);
      if (err.cause) log.error(`Cause: ${err.cause.message || String(err.cause)}`);
      if (err.cause?.cause) log.error(`Cause2: ${err.cause.cause.message || err.cause.cause.code || String(err.cause.cause)}`);
      log.error(`Error type: ${err.constructor?.name}`);
      process.exit(1);
    }
  });

program
  .command('repair-references')
  .description('Scan all posts/pages (all Polylang languages) and normalize image URLs against the current media library')
  .action(async () => {
    try {
      log.header('Repair Post References');
      log.info('Scanning media library and all posts/pages...');
      let last = '';
      const count = await repairPostReferences({
        onProgress: (done, total, slug) => {
          last = `\r  Checking ${done}/${total}: ${slug.substring(0, 40)}...`;
          process.stdout.write(last + ' '.repeat(Math.max(0, 60 - last.length)));
        },
      });
      process.stdout.write('\r' + ' '.repeat(70) + '\r');
      if (count === 0) {
        log.success('No posts needed updating.');
      } else {
        log.success(`Updated ${count} post/page(s) with corrected image URLs.`);
      }
    } catch (err) {
      log.error(`Repair failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
