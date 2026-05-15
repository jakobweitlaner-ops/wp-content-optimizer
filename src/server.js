import 'dotenv/config';
// Disable TLS cert verification for environments with self-signed certificate chains
// (matches WP_INSECURE behaviour for axios and NODE_TLS_REJECT_UNAUTHORIZED for child procs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { previewMediaFixes, applyMediaFixes, auditAltTextWithAI } from './modules/media-optimizer.js';
import { previewSeoFixes, applySeoFixes, auditSeoItems, generateSeoFixForItem, getSeoImageProposals } from './modules/seo-optimizer.js';
import { updatePost, updatePage } from './utils/wp-api.js';

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

app.get('/preview/audit-media-ai', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text, data) =>
    res.write(`data: ${JSON.stringify({ type, text, ...(data ? { data } : {}) })}\n\n`);

  auditAltTextWithAI({
    onProgress: (done, total, slug) =>
      send('progress', `Analysiere ${done}/${total}: ${slug}`),
    onProposal: (p) =>
      send('out', `⚠ ${p.filename}\n  Aktuell: "${p.currentAltText || '(leer)'}"\n  Vorschlag: "${p.proposedAltText}"\n  Grund: ${p.reason}`),
    onError: (slug, msg) =>
      send('err', `Fehler bei ${slug}: ${msg}`),
  })
    .then((proposals) => {
      send('proposals', `${proposals.length} Vorschläge gefunden.`, proposals);
      send('done', 'success');
      res.end();
    })
    .catch((err) => {
      send('err', `KI-Analyse fehlgeschlagen: ${err.message}`);
      send('done', 'error');
      res.end();
    });
});



app.get('/api/seo-audit', async (req, res) => {
  try {
    const items = await auditSeoItems();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/seo-fix', async (req, res) => {
  const { id, type, field } = req.query;
  if (!id || !type || !field) return res.status(400).json({ error: 'id, type, field required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const value = await generateSeoFixForItem(parseInt(id, 10), type, field);
    res.json({ value: value || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seo-noindex', express.json(), async (req, res) => {
  const { id, type, noindex } = req.body;
  if (!id || !type) return res.status(400).json({ error: 'id and type required' });
  try {
    const data = { meta: { '_yoast_wpseo_meta-robots-noindex': noindex ? 1 : 0 } };
    if (type === 'page') await updatePage(id, data);
    else await updatePost(id, data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.get('/api/seo-images', async (req, res) => {
  const { id, type, keyphrase } = req.query;
  if (!id || !type || !keyphrase) return res.status(400).json({ error: 'id, type, keyphrase required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const proposals = await getSeoImageProposals(parseInt(id, 10), type, keyphrase);
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/preview/audit-seo', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text, data) =>
    res.write(`data: ${JSON.stringify({ type, text, ...(data ? { data } : {}) })}\n\n`);

  previewSeoFixes({
    onProgress: (done, total, title) =>
      send('progress', `Generiere Fixes ${done}/${total}: ${title}`),
    onError: (title, msg) =>
      send('err', `⚠ Kein Fix für "${title}": ${msg}`),
  })
    .then((proposals) => {
      send('proposals', `${proposals.length} Fix(es) gefunden.`, proposals);
      send('done', 'success');
      res.end();
    })
    .catch((err) => {
      send('err', `SEO-Vorschau fehlgeschlagen: ${err.message}`);
      send('done', 'error');
      res.end();
    });
});

app.post('/apply/audit-seo', express.json(), async (req, res) => {
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    res.status(400).json({ error: 'changes array required' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  try {
    send('out', `Wende ${changes.length} SEO-Fix(es) an...`);
    const results = await applySeoFixes(changes);
    for (const r of results) {
      if (r.success) {
        const preview = r.value?.substring(0, 50);
        send('out', `✔ ID ${r.id} (${r.type}) → ${r.field}: "${preview}${r.value?.length > 50 ? '…' : ''}"`);
      } else {
        send('err', `✖ ID ${r.id}: ${r.error}`);
      }
    }
    const ok = results.filter((r) => r.success).length;
    send('out', `Fertig. ${ok}/${results.length} SEO-Fixes gespeichert.`);
    send('done', ok > 0 ? 'success' : 'error');
  } catch (err) {
    send('err', `Fehler: ${err.message}`);
    send('done', 'error');
  }
  res.end();
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
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    res.status(400).json({ error: 'changes array required' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  try {
    send('out', `Wende ${changes.length} Fix(es) an...`);
    const results = await applyMediaFixes(changes);
    for (const r of results) {
      if (r.success) send('out', `✔ ID ${r.id} → alt: "${r.altText}"`);
      else send('err', `✖ ID ${r.id}: ${r.error}`);
    }
    const ok = results.filter((r) => r.success).length;
    send('out', `Fertig. ${ok}/${results.length} Alt-Texte gespeichert.`);
    send('done', ok > 0 ? 'success' : 'error');
  } catch (err) {
    send('err', `Fehler: ${err.message}`);
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
