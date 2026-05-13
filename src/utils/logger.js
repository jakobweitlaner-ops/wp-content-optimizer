import chalk from 'chalk';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const log = {
  info: (msg) => console.log(chalk.blue('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✔'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.log(chalk.red('✖'), msg),
  header: (msg) => console.log(chalk.bold.cyan(`\n${msg}\n${'─'.repeat(msg.length)}`)),
  row: (label, value, color = 'white') => {
    console.log(`  ${chalk.dim(label.padEnd(20))} ${chalk[color](value)}`);
  },
};

export function saveReport(filePath, data) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.success(`Report saved to ${filePath}`);
  } catch (err) {
    log.error(`Failed to save report: ${err.message}`);
  }
}
