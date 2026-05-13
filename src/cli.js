#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { checkLinks } from './modules/link-checker.js';
import { auditSeo } from './modules/seo-optimizer.js';
import { auditMedia } from './modules/media-optimizer.js';
import { testConnection } from './utils/wp-api.js';
import { log } from './utils/logger.js';

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
  .description('Audit SEO quality of all posts (score 0-100)')
  .option('--min-score <number>', 'Only show posts below this score', '80')
  .option('--fix', 'Auto-fix title and excerpt issues using Claude AI (requires ANTHROPIC_API_KEY)')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      const minScore = parseInt(options.minScore, 10);
      await auditSeo({ minScore, output: options.output, fix: !!options.fix });
    } catch (err) {
      log.error(`SEO audit failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('audit-media')
  .description('Audit media files for missing alt texts, large sizes, bad filenames')
  .option('--fix', 'Auto-generate missing alt text using Claude AI Vision (requires ANTHROPIC_API_KEY)')
  .option('-o, --output <file>', 'Save report to file')
  .action(async (options) => {
    try {
      await auditMedia({ output: options.output, fix: !!options.fix });
    } catch (err) {
      log.error(`Media audit failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
