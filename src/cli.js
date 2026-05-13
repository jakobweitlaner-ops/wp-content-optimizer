#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { checkLinks } from './modules/link-checker.js';
import { auditSeo } from './modules/seo-optimizer.js';
import { auditMedia } from './modules/media-optimizer.js';
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

      log.info('Analyzing results with Claude...\n');
      const report = await getSiteStatus({ seoResults, linkResults, mediaResults });
      console.log(report);
    } catch (err) {
      log.error(`Status check failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
