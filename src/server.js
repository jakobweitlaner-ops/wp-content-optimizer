import 'dotenv/config';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.UI_PORT || 3000;

app.use(express.static(join(__dirname, 'public')));

app.get('/run/:command', (req, res) => {
  const allowed = ['test-connection', 'check-links', 'audit-seo', 'audit-media'];
  const command = req.params.command;

  if (!allowed.includes(command)) {
    res.status(400).end('Unknown command');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text) => {
    res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  };

  const child = spawn('node', ['src/cli.js', command], {
    env: process.env,
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

app.listen(PORT, () => {
  console.log(`\nWP Content Optimizer UI running at http://localhost:${PORT}`);
  console.log('Opening browser...\n');
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start ${url}` : `open ${url}`;
  exec(cmd);
});
