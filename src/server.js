import 'dotenv/config';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { previewMediaFixes, applyMediaFixes } from './modules/media-optimizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.UI_PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

app.get('/run/:command', (req, res) => {
  const allowed = ['test-connection', 'check-links', 'audit-seo', 'audit-media', 'get-status'];
  const command = req.params.command;

  if (!allowed.includes(command)) {
    res.status(400).end('Unknown command');
    return;
  }

  const args = ['src/cli.js', command];
  if (command === 'audit-seo' && req.query.ai === '1') args.push('--ai');
  if (command === 'audit-media' && req.query.fix === '1') args.push('--fix');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text) => {
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  };

  const { ANTHROPIC_BASE_URL, ...spawnEnv } = process.env;
  const child = spawn('node', args, {
    env: { ...spawnEnv, FORCE_COLOR: '0', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    cwd: join(__dirname, '..'),
  });

  child.stdout.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach((line) => send('out', line));
  });

  child.stderr.on('data', (d) => {
    d.toString().split('\n').filter(Boolean).forEach((line) => send('err', line));
  });

  child.on('close', (code) => {
    send('done', code === 0 ? 'success' : 'error');
    res.end();
  });

  req.on('close', () => child.kill());
});

app.get('/preview/audit-media', async (req, res) => {
  try {
    const proposals = await previewMediaFixes();
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/apply/audit-media', express.json(), async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids array required' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  try {
    send('out', `Applying ${ids.length} fix(es)...`);
    const results = await applyMediaFixes(ids);
    for (const r of results) {
      if (r.success) send('out', `✔ ${r.filename} → alt: "${r.altText}"`);
      else send('err', `✖ ${r.filename}: ${r.error}`);
    }
    const ok = results.filter((r) => r.success).length;
    send('out', `Done. ${ok}/${results.length} fixes applied.`);
    send('done', 'success');
  } catch (err) {
    send('err', `Failed: ${err.message}`);
    send('done', 'error');
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(`\nWP Content Optimizer UI running at http://localhost:${PORT}`);
  console.log('Opening browser...\n');
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start ${url}` : `open ${url}`;
  exec(cmd);
});
