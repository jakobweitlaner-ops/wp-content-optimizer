#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { checkLinks } from './modules/link-checker.js';
import { auditSeo } from './modules/seo-optimizer.js';
import { auditMedia, compressOversizedImages } from './modules/media-optimizer.js';
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
  .option('--threshold <kb>', 'File size threshold in KB (default: 200)', '200')
  .option('--quality <number>', 'JPEG/WebP compression quality 1-100 (default: 82)', '82')
  .option('--max-width <px>', 'Maximum image width in pixels (default: 2560)', '2560')
  .option('--max-height <px>', 'Maximum image height in pixels (default: 2560)', '2560')
  .option('--dry-run', 'Only list oversized images without compressing')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      const threshold = parseInt(options.threshold, 10) * 1024;
      const quality = parseInt(options.quality, 10);
      const maxWidth = parseInt(options.maxWidth, 10);
      const maxHeight = parseInt(options.maxHeight, 10);
      const dryRun = !!options.dryRun;

      log.header('Image Compression');
      if (dryRun) log.info('Dry run – no images will be changed.');
      log.info(`Threshold: ${options.threshold} KB | Quality: ${quality} | Max: ${maxWidth}x${maxHeight}px`);
      log.info('Scanning media library...');

      let totalSaved = 0;
      const results = await compressOversizedImages({
        threshold,
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

program.parse();
