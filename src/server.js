import 'dotenv/config';
// Disable TLS cert verification for environments with self-signed certificate chains
// (matches WP_INSECURE behaviour for axios and NODE_TLS_REJECT_UNAUTHORIZED for child procs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import { previewMediaFixes, applyMediaFixes, auditAltTextWithAI, auditFilenamesWithAI, applyFilenameRenames, detectOversizedImages, compressOversizedImages, repairPostReferences, uploadFromPC, updateMediaReferences, updateFeaturedImageReferences } from './modules/media-optimizer.js';
import { previewSeoFixes, applySeoFixes, auditSeoItems, generateSeoFixForItem, getSeoImageProposals, applyBrandFix } from './modules/seo-optimizer.js';
import { updatePost, updatePage, getMediaItem } from './utils/wp-api.js';
import { getPostsWithImages, getMediaLibrary, replaceImage } from './modules/seasonal-replacer.js';
import axios from 'axios';
import https from 'https';

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

app.get('/api/h1-overview', async (req, res) => {
  try {
    const items = await auditSeoItems();
    const { hasBrandIssue } = await import('./utils/content-normalizer.js');
    res.json(items.map(({ id, type, title, url, lang, currentH1, currentKeyphrase }) => ({
      id, type, title, url, lang, currentH1, currentKeyphrase,
      hasBrandIssue: hasBrandIssue(title + ' ' + (currentH1 || '')),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/seo-fix', async (req, res) => {
  const { id, type, field, keyphrase = '' } = req.query;
  if (!id || !type || !field) return res.status(400).json({ error: 'id, type, field required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  try {
    const value = await generateSeoFixForItem(parseInt(id, 10), type, field, keyphrase);
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

app.post('/api/seo-fix-brand', express.json(), async (req, res) => {
  const { id, type } = req.body;
  if (!id || !type) return res.status(400).json({ error: 'id and type required' });
  try {
    const result = await applyBrandFix(parseInt(id, 10), type);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// ── Filename Rename ────────────────────────────────────────────

app.get('/preview/audit-filenames', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text, data) =>
    res.write(`data: ${JSON.stringify({ type, text, ...(data ? { data } : {}) })}\n\n`);

  auditFilenamesWithAI({
    onProgress: (done, total, slug) =>
      send('progress', `Analysiere ${done}/${total}: ${slug}`),
    onProposal: (p) => {
      if (p.quality === 'poor') send('out', `⚠ ${p.filename} → ${p.proposedFilename}  (${p.reason})`);
    },
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

app.post('/apply/audit-filenames', express.json(), (req, res) => {
  const changes = req.body?.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    res.status(400).json({ error: 'changes array required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text, data) =>
    res.write(`data: ${JSON.stringify({ type, text, ...(data ? { data } : {}) })}\n\n`);

  send('out', `Benenne ${changes.length} Bild(er) um…`);

  applyFilenameRenames(changes, {
    onProgress: (done, total, slug) =>
      send('progress', `Verarbeite ${done}/${total}: ${slug}`),
    onResult: (r) =>
      send('out', `✔ ${r.originalFilename} → ${r.newFilename}`),
    onError: (slug, msg) =>
      send('err', `✖ ${slug}: ${msg}`),
  })
    .then(({ results, refsUpdated, featuredUpdated }) => {
      const ok = results.filter((r) => r.success).length;
      if (refsUpdated > 0) send('out', `🔗 ${refsUpdated} Beitrag/Seite(n) mit aktualisierten Bild-URLs.`);
      if (featuredUpdated > 0) send('out', `🖼️ ${featuredUpdated} Beitrag/Seite(n) mit aktualisiertem Titelbild.`);
      send('out', `Fertig. ${ok}/${results.length} Bild(er) umbenannt.`);
      send('done', ok > 0 ? 'success' : 'error');
      res.end();
    })
    .catch((err) => {
      send('err', `Fehler: ${err.message}`);
      send('done', 'error');
      res.end();
    });
});

app.post('/api/rename-image', express.json(), async (req, res) => {
  const { id, newFilename } = req.body || {};
  if (!id || !newFilename) return res.status(400).json({ error: 'id and newFilename required' });
  try {
    const { results, refsUpdated, featuredUpdated } = await applyFilenameRenames(
      [{ id, newFilename }],
    );
    const result = results[0];
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ ...result, refsUpdated, featuredUpdated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image Compression ──────────────────────────────────────────

app.get('/api/compress-images/detect', async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold || '204800', 10);
    const items = await detectOversizedImages({ threshold });
    res.json(
      items.map((item) => ({
        id: item.id,
        filename: item.slug,
        url: item.source_url,
        sizeKb: Math.round((item.media_details?.filesize || 0) / 1024),
        width: item.media_details?.width || null,
        height: item.media_details?.height || null,
        mimeType: item.mime_type,
        altText: item.alt_text || '',
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/compress-images/apply', express.json(), (req, res) => {
  const { ids, targetSizeKb = null, quality = 82, maxWidth = 2560, maxHeight = 2560, threshold = 204800 } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text, data) =>
    res.write(`data: ${JSON.stringify({ type, text, ...(data ? { data } : {}) })}\n\n`);

  compressOversizedImages({
    threshold,
    targetSizeKb,
    quality,
    maxWidth,
    maxHeight,
    dryRun: false,
    ids: Array.isArray(ids) && ids.length > 0 ? ids : null,
    onProgress: (done, total, slug) =>
      send('progress', `Komprimiere ${done}/${total}: ${slug}`),
    onResult: (r) => {
      if (r.success) {
        send(
          'out',
          `✔ ${r.filename}: ${Math.round(r.originalSize / 1024)} KB → ${Math.round(r.compressedSize / 1024)} KB (−${r.savingsPercent}%)`,
          r,
        );
      }
    },
    onError: (slug, msg) => send('err', `✖ ${slug}: ${msg}`),
    onRefsUpdated: (count, mappings) => {
      if (count > 0) {
        send('out', `🔗 ${count} Seite(n) mit geänderten Bild-URLs aktualisiert.`);
      }
    },
  })
    .then((results) => {
      const ok = results.filter((r) => r.success).length;
      const totalSavedKb = Math.round(
        results.filter((r) => r.success).reduce((sum, r) => sum + r.savings, 0) / 1024,
      );
      send('done-data', `${ok}/${results.length} komprimiert. Gespart: ${totalSavedKb} KB.`, results);
      send('done', 'success');
      res.end();
    })
    .catch((err) => {
      send('err', `Fehler: ${err.message}`);
      send('done', 'error');
      res.end();
    });
});

app.post('/api/repair-references', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);

  repairPostReferences({
    onProgress: (done, total, slug) => send('progress', `${done}/${total}: ${slug}`),
  })
    .then((count) => {
      send('out', `${count} Beitrag/Seite(n) aktualisiert.`);
      send('done', 'success');
      res.end();
    })
    .catch((err) => {
      send('err', `Fehler: ${err.message}`);
      send('done', 'error');
      res.end();
    });
});

// ── Seasonal Image Replacement ────────────────────────────────

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// Expose WP base URL to the frontend so it knows which images need proxying
app.get('/api/seasonal/config', (req, res) => {
  res.json({ wpBase: (process.env.WP_URL || '').replace(/\/$/, '') });
});

// Proxy WP image URLs through our server so the browser doesn't hit SSL issues.
// Only proxies HTTP/HTTPS URLs — no local file paths or other schemes allowed.
app.get('/api/seasonal/proxy-image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end('url required');
  if (!/^https?:\/\//i.test(url)) return res.status(400).end('invalid url');
  try {
    const upstream = await axios.get(url, {
      responseType: 'arraybuffer',
      httpsAgent: insecureAgent,
      timeout: 15000,
      maxRedirects: 5,
    });
    const ct = upstream.headers['content-type'] || 'image/jpeg';
    if (!ct.startsWith('image/')) {
      console.warn(`[proxy] non-image response for ${url}: ${ct} (${upstream.status})`);
      return res.status(502).end('not an image');
    }
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(upstream.data));
  } catch (err) {
    console.error(`[proxy] failed to fetch ${url}: ${err.message}`);
    res.status(502).end('image fetch failed');
  }
});

app.get('/api/seasonal/posts', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  // Keep-alive ping every 20 s to prevent proxy/load-balancer timeouts during
  // long content-fetching phases where no post events are emitted.
  const heartbeat = setInterval(() => res.write(':\n\n'), 20_000);

  getPostsWithImages({
    onPost: (post) => send('post', post),
  })
    .then((items) => {
      clearInterval(heartbeat);
      send('done', { total: items.length });
      res.end();
    })
    .catch((err) => {
      clearInterval(heartbeat);
      send('error', { message: err.message });
      res.end();
    });
});

app.get('/api/seasonal/media', async (req, res) => {
  try {
    const { page = 1, search = '' } = req.query;
    const items = await getMediaLibrary({ page: parseInt(page, 10), perPage: 30, search });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/seasonal/replace', express.json(), async (req, res) => {
  const { postId, postType, mode, oldSrc, oldMediaId, newMediaId, newSrc, postUrl } = req.body;
  if (!postId || !postType || !mode || !newMediaId) {
    return res.status(400).json({ error: 'postId, postType, mode, newMediaId required' });
  }
  try {
    // Build complete size-variant URL mappings BEFORE calling replaceImage so that
    // replaceImage can update all srcset URLs (mobile variants) in one pass.
    const urlMappings = {};
    if (oldSrc && newSrc && oldSrc !== newSrc) urlMappings[oldSrc] = newSrc;

    if (oldMediaId) {
      try {
        const [oldItem, newItem] = await Promise.all([
          getMediaItem(oldMediaId),
          getMediaItem(newMediaId),
        ]);
        const oldSizes = oldItem.media_details?.sizes || {};
        const newSizes = newItem.media_details?.sizes || {};
        for (const [sizeName, oldSizeData] of Object.entries(oldSizes)) {
          if (newSizes[sizeName]?.source_url && oldSizeData.source_url !== newSizes[sizeName].source_url) {
            urlMappings[oldSizeData.source_url] = newSizes[sizeName].source_url;
          }
        }
        if (oldItem.source_url !== newItem.source_url) {
          urlMappings[oldItem.source_url] = newItem.source_url;
        }
      } catch {}
    }

    const idMap = (oldMediaId && newMediaId) ? { [oldMediaId]: newMediaId } : {};

    // Pass urlMappings so replaceImage updates all size-variant URLs (incl. srcset) at once
    await replaceImage({ postId, postType, mode, oldSrc, oldMediaId, newMediaId, newSrc, urlMappings });

    // Best-effort cache invalidation: fetch the post URL with both desktop and mobile
    // User-Agents so device-based server caches (e.g. World4You, LiteSpeed) regenerate
    // both variants. Failures are silently ignored — the content update already succeeded.
    if (postUrl) {
      const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      const UA_MOBILE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
      const purgeOpts  = { timeout: 8000, validateStatus: () => true };
      await Promise.all([
        axios.get(postUrl,  { ...purgeOpts, headers: { 'User-Agent': UA_DESKTOP, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }).catch(() => {}),
        axios.get(postUrl,  { ...purgeOpts, headers: { 'User-Agent': UA_MOBILE,  'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }).catch(() => {}),
        axios({ method: 'PURGE', url: postUrl, ...purgeOpts }).catch(() => {}),
      ]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[replace]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-from-pc', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (type, data = {}) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  const { postId, postType, mode, oldMediaId, oldSrc, filename } = req.query;
  const mimeType = (req.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
  const originalFilename = filename || 'upload.jpg';

  uploadFromPC({
    buffer: req.body,
    mimeType,
    originalFilename,
    postId: parseInt(postId, 10),
    postType,
    mode,
    oldMediaId: oldMediaId ? parseInt(oldMediaId, 10) : null,
    oldSrc: oldSrc || null,
    onProgress: (message) => send('progress', { message }),
  })
    .then((result) => {
      send('done', result);
      res.end();
    })
    .catch((err) => {
      send('error', { message: err.message });
      res.end();
    });
});

app.listen(PORT, () => {
  console.log(`\nWP Content Optimizer UI running at http://localhost:${PORT}`);
  console.log('Opening browser...\n');
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === 'win32' ? `start ${url}` : `open ${url}`;
  exec(cmd);
});
