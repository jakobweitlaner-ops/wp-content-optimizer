import https from 'https';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import sharp from 'sharp';
import path from 'path';
import { getMedia, updateMedia, uploadMedia, deleteMedia, replaceMedia, getMediaItem, getPosts, getPages, updatePost, updatePage, getSiteContext } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

async function fetchImageAsBase64(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    httpsAgent: insecureAgent,
    timeout: 15000,
  });
  const mimeType = (response.headers['content-type'] || 'image/jpeg').split(';')[0];
  return { base64: Buffer.from(response.data).toString('base64'), mimeType };
}

async function fetchImageBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    httpsAgent: insecureAgent,
    timeout: 30000,
  });
  const mimeType = (response.headers['content-type'] || 'image/jpeg').split(';')[0];
  return { buffer: Buffer.from(response.data), mimeType };
}

const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

async function _compressToTargetSize(resized, mimeType, targetBytes) {
  // PNG: try lossless first, then fall back to WebP lossy
  if (mimeType === 'image/png') {
    const lossless = await sharp(resized).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    if (lossless.length <= targetBytes) return { buffer: lossless, mimeType: 'image/png' };
  }

  // Binary search for highest quality that stays within targetBytes
  const format = mimeType === 'image/webp' ? 'webp' : 'jpeg';
  const outMimeType = format === 'webp' ? 'image/webp' : 'image/jpeg';
  let lo = 20, hi = 90, best = null;

  for (let i = 0; i < 9 && hi - lo > 2; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = await sharp(resized)[format]({ quality: mid }).toBuffer();
    if (candidate.length <= targetBytes) {
      best = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Best-effort: nothing fit within target → use lowest quality
  if (!best) best = await sharp(resized)[format]({ quality: lo }).toBuffer();
  return { buffer: best, mimeType: outMimeType };
}

export async function compressImageBuffer(buffer, mimeType, { targetSizeBytes = null, quality = 82, maxWidth = 2560, maxHeight = 2560 } = {}) {
  if (!COMPRESSIBLE_TYPES.has(mimeType)) {
    throw new Error(`Unsupported format for compression: ${mimeType}`);
  }

  const resized = await sharp(buffer)
    .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  if (targetSizeBytes) {
    return _compressToTargetSize(resized, mimeType, targetSizeBytes);
  }

  // Fixed-quality path (kept for CLI --quality flag and tests)
  let outMimeType = mimeType;
  let pipeline = sharp(resized);
  if (mimeType === 'image/png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality });
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    outMimeType = 'image/jpeg';
  }

  return { buffer: await pipeline.toBuffer(), mimeType: outMimeType };
}

function collectUrls(item) {
  const urls = new Set();
  if (item.source_url) urls.add(item.source_url);
  const sizes = item.media_details?.sizes || {};
  for (const sizeData of Object.values(sizes)) {
    if (sizeData.source_url) urls.add(sizeData.source_url);
  }
  return urls;
}

function buildUrlMappings(oldItem, newItem) {
  const mappings = {};
  const oldUrls = collectUrls(oldItem);
  const newUrls = collectUrls(newItem);
  for (const oldUrl of oldUrls) {
    if (!newUrls.has(oldUrl)) {
      // Find the corresponding new URL by size name
      const oldSizes = oldItem.media_details?.sizes || {};
      const newSizes = newItem.media_details?.sizes || {};
      for (const [sizeName, sizeData] of Object.entries(oldSizes)) {
        if (sizeData.source_url === oldUrl && newSizes[sizeName]) {
          mappings[oldUrl] = newSizes[sizeName].source_url;
        }
      }
      // Handle source_url change
      if (oldItem.source_url === oldUrl && newItem.source_url !== oldUrl) {
        mappings[oldUrl] = newItem.source_url;
      }
    }
  }
  return mappings;
}

export async function updateMediaReferences(urlMappings, idMappings = {}) {
  if (!urlMappings || Object.keys(urlMappings).length === 0) return 0;

  // Build pathname → newUrl lookup so we match regardless of domain/protocol
  // (handles http↔https, localhost vs production domain, migrated sites)
  const pathToNewUrl = {};
  for (const [oldUrl, newUrl] of Object.entries(urlMappings)) {
    try { pathToNewUrl[new URL(oldUrl).pathname] = newUrl; } catch {}
  }

  // lang=all fetches posts in every Polylang language; ignored on non-Polylang sites
  const [posts, pages] = await Promise.all([getPosts({ lang: 'all' }), getPages({ lang: 'all' })]);
  let updatedCount = 0;

  for (const item of [...posts, ...pages]) {
    const raw = item.content?.raw || '';
    let updated = raw;

    // Exact URL replacement (fast path when domains match)
    for (const [oldUrl, newUrl] of Object.entries(urlMappings)) {
      updated = updated.split(oldUrl).join(newUrl);
    }

    // Path-based replacement: catches http↔https and domain mismatches
    updated = updated.replace(/https?:\/\/[^\s"'>]+\/wp-content\/uploads\/[^\s"'>]+/g, (url) => {
      try {
        const mapped = pathToNewUrl[new URL(url).pathname];
        return mapped || url;
      } catch { return url; }
    });

    // Update Gutenberg block comments {"id":OLD} and CSS classes wp-image-OLD
    // so WordPress regenerates correct srcset for responsive/mobile images.
    // Use regex (not string split) to avoid matching IDs that are prefixes of longer IDs
    // e.g. replacing "id":12 must NOT corrupt "id":1234 or wp-image-1234.
    for (const [oldId, newId] of Object.entries(idMappings)) {
      updated = updated
        .replace(new RegExp(`\\bwp-image-${oldId}\\b`, 'g'), `wp-image-${newId}`)
        .replace(new RegExp(`"id":${oldId}(?!\\d)`, 'g'), `"id":${newId}`)
        .replace(new RegExp(`"id": ${oldId}(?!\\d)`, 'g'), `"id": ${newId}`);
    }

    if (updated !== raw) {
      const fn = item.type === 'page' ? updatePage : updatePost;
      await fn(item.id, { content: updated });
      updatedCount++;
    }
  }

  return updatedCount;
}

export async function repairPostReferences({ onProgress } = {}) {
  const allMedia = await getMedia({ media_type: 'image' });

  // pathname → canonical URL  (for URL repair — fixes desktop references)
  const pathToUrl = new Map();
  // pathname → media item ID  (for block-ID repair — fixes mobile srcset)
  // size variant paths all point to the same item ID as the original
  const pathToId = new Map();

  for (const item of allMedia) {
    for (const url of collectUrls(item)) {
      try {
        const p = new URL(url).pathname;
        pathToUrl.set(p, url);
        pathToId.set(p, item.id);
      } catch {}
    }
  }
  if (pathToUrl.size === 0) return 0;

  const [posts, pages] = await Promise.all([getPosts({ lang: 'all' }), getPages({ lang: 'all' })]);
  const all = [...posts, ...pages];
  let updatedCount = 0;

  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    if (onProgress) onProgress(i + 1, all.length, item.slug || String(item.id));

    const raw = item.content?.raw || '';
    let updated = raw;

    // Pass 1 — fix URLs to canonical form (already-correct URLs are unchanged)
    updated = updated.replace(/https?:\/\/[^\s"'>]+\/wp-content\/uploads\/[^\s"'>]+/g, (url) => {
      try {
        const canonical = pathToUrl.get(new URL(url).pathname);
        return canonical || url;
      } catch { return url; }
    });

    // Pass 2 — fix wp-image-{id} CSS class in every <img> tag
    // After pass 1 the src is canonical, so we can look up the correct media ID.
    // Only changes the class when the stored ID differs from what the src resolves to.
    updated = updated.replace(/<img[^>]+>/g, (imgTag) => {
      const srcMatch = imgTag.match(/\bsrc="([^"]+)"/);
      if (!srcMatch) return imgTag;
      try {
        const correctId = pathToId.get(new URL(srcMatch[1]).pathname);
        if (!correctId) return imgTag;
        return imgTag.replace(/\bwp-image-(\d+)\b/, (cls, oldId) =>
          parseInt(oldId, 10) !== correctId ? `wp-image-${correctId}` : cls,
        );
      } catch { return imgTag; }
    });

    // Pass 3 — sync Gutenberg block comment {"id":X} with the wp-image-X class
    // Uses the class value fixed in pass 2 as the source of truth.
    // Block comment format: <!-- wp:image {"id":123,...} --> ... <!-- /wp:image -->
    updated = updated.replace(
      /<!-- wp:image (\{[^\n]*?\}) -->([\s\S]*?)<!-- \/wp:image -->/g,
      (blockMatch, jsonStr, blockBody) => {
        const classMatch = blockBody.match(/\bwp-image-(\d+)\b/);
        if (!classMatch) return blockMatch;
        const correctId = parseInt(classMatch[1], 10);
        const newJson = jsonStr.replace(/"id"\s*:\s*\d+/, `"id":${correctId}`);
        if (newJson === jsonStr) return blockMatch;
        return `<!-- wp:image ${newJson} -->${blockBody}<!-- /wp:image -->`;
      },
    );

    if (updated !== raw) {
      const fn = item.type === 'page' ? updatePage : updatePost;
      await fn(item.id, { content: updated });
      updatedCount++;
    }
  }

  return updatedCount;
}

export async function detectOversizedImages({ threshold = MAX_FILE_SIZE_BYTES } = {}) {
  const media = await getMedia({ media_type: 'image' });
  return media.filter((item) => {
    const fileSize = item.media_details?.filesize;
    const mimeType = item.mime_type || '';
    return fileSize && fileSize > threshold && COMPRESSIBLE_TYPES.has(mimeType);
  });
}

export async function compressMediaItem(item, { targetSizeKb = null, quality = 82, maxWidth = MAX_WIDTH, maxHeight = MAX_HEIGHT } = {}) {
  const { buffer: originalBuffer, mimeType } = await fetchImageBuffer(item.source_url);

  if (!COMPRESSIBLE_TYPES.has(mimeType)) {
    throw new Error(`Format nicht unterstützt: ${mimeType}`);
  }

  const { buffer: compressedBuffer, mimeType: outMimeType } = await compressImageBuffer(
    originalBuffer,
    mimeType,
    { targetSizeBytes: targetSizeKb ? targetSizeKb * 1024 : null, quality, maxWidth, maxHeight },
  );

  if (compressedBuffer.length >= originalBuffer.length) {
    throw new Error('Komprimiertes Bild ist nicht kleiner als das Original');
  }

  // Try in-place replacement via the custom plugin endpoint.
  // Falls back to uploading a new media item when the endpoint returns 404
  // (plugin not installed or outdated).
  let result;
  let replacedInPlace = false;
  try {
    result = await replaceMedia(item.id, compressedBuffer, outMimeType);
    replacedInPlace = true;
  } catch (err) {
    if (err.response?.status !== 404) throw err;
    const origFilename = path.basename(item.source_url.split('?')[0]);
    result = await uploadMedia(compressedBuffer, outMimeType, origFilename, {
      title: item.title?.rendered || item.slug,
      alt_text: item.alt_text || '',
    });
  }

  // Fetch updated media item to detect any URL changes (e.g. thumbnail extension mismatch)
  const updatedItem = await getMediaItem(result.id);
  const urlMappings = buildUrlMappings(item, updatedItem);

  return {
    originalId: item.id,
    originalUrl: item.source_url,
    originalSize: originalBuffer.length,
    compressedSize: compressedBuffer.length,
    savings: originalBuffer.length - compressedBuffer.length,
    savingsPercent: Math.round((1 - compressedBuffer.length / originalBuffer.length) * 100),
    newId: updatedItem.id,
    newUrl: updatedItem.source_url,
    replacedInPlace,
    urlMappings,
  };
}

export async function compressOversizedImages({
  threshold = MAX_FILE_SIZE_BYTES,
  targetSizeKb = null,
  quality = 82,
  maxWidth = MAX_WIDTH,
  maxHeight = MAX_HEIGHT,
  dryRun = false,
  ids = null,
  onProgress,
  onResult,
  onError,
  onRefsUpdated,
} = {}) {
  let oversized = await detectOversizedImages({ threshold });
  if (ids && ids.length > 0) {
    const idSet = new Set(ids.map(Number));
    oversized = oversized.filter((item) => idSet.has(item.id));
  }
  const results = [];
  const allUrlMappings = {};
  let done = 0;

  for (const item of oversized) {
    done++;
    if (onProgress) onProgress(done, oversized.length, item.slug);

    if (dryRun) {
      const sizKb = Math.round((item.media_details?.filesize || 0) / 1024);
      const preview = { id: item.id, filename: item.slug, url: item.source_url, sizeKb: sizKb, dryRun: true };
      results.push(preview);
      if (onResult) onResult(preview);
      continue;
    }

    try {
      const result = await compressMediaItem(item, { targetSizeKb, quality, maxWidth, maxHeight });
      Object.assign(allUrlMappings, result.urlMappings);
      results.push({ ...result, filename: item.slug, success: true });
      if (onResult) onResult({ ...result, filename: item.slug, success: true });
    } catch (err) {
      const failure = { id: item.id, filename: item.slug, success: false, error: err.message };
      results.push(failure);
      if (onError) onError(item.slug, err.message);
    }
  }

  // Update all changed URLs in post/page content in a single pass
  if (!dryRun && Object.keys(allUrlMappings).length > 0) {
    const refsUpdated = await updateMediaReferences(allUrlMappings);
    if (onRefsUpdated) onRefsUpdated(refsUpdated, allUrlMappings);
  }

  return results;
}

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

function generateAltText(item) {
  const title = item.title?.rendered?.trim();
  if (title && title.length > 3) return title;
  const slug = (item.slug || '').replace(/[-_]+/g, ' ').trim();
  return slug || 'image';
}

export async function previewMediaFixes() {
  const media = await getMedia({ media_type: 'image' });
  const proposals = [];

  for (const item of media) {
    const issues = auditMediaItem(item);
    const missingAlt = issues.find((i) => i === 'Missing alt text');
    if (missingAlt) {
      proposals.push({
        id: item.id,
        filename: item.slug,
        url: item.source_url,
        currentAltText: item.alt_text || '',
        proposedAltText: generateAltText(item),
      });
    }
  }

  return proposals;
}

export async function applyMediaFixes(changes) {
  // changes: [{id, altText}]
  const results = [];

  for (const { id, altText } of changes) {
    try {
      const updated = await updateMedia(id, { alt_text: altText });
      const saved = updated?.alt_text ?? altText;
      results.push({ id, altText: saved, success: true });
    } catch (err) {
      results.push({ id, error: err.message, success: false });
    }
  }

  return results;
}

async function promisePool(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export async function auditAltTextWithAI({ onProgress, onProposal, onError } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });
  const [media, siteContext] = await Promise.all([
    getMedia({ media_type: 'image' }),
    getSiteContext().catch(() => ''),
  ]);
  const proposals = [];
  let done = 0;

  const tasks = media.map((item) => async () => {
    const altText = item.alt_text?.trim() || '';
    done++;
    if (onProgress) onProgress(done, media.length, item.slug);

    try {
      const { base64, mimeType } = await fetchImageAsBase64(item.source_url);

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            {
              type: 'text',
              text: `${siteContext ? `Kontext der Webseite:\n${siteContext}\n\n` : ''}Aktueller Alt-Text des Bildes: "${altText || '(leer)'}"\n\nBewerte diesen Alt-Text im Kontext der Webseite. Ist er korrekt, beschreibend und passend? Generiere bei Bedarf einen besseren Alt-Text der den Bildinhalt beschreibt und zur Webseite passt. Antworte ausschließlich mit JSON auf Deutsch:\n{"quality":"good"|"poor","reason":"ein Satz","suggestion":"verbesserter Alt-Text auf Deutsch oder null"}`,
            },
          ],
        }],
      });

      const text = response.content[0]?.text || '';
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return;
      const json = JSON.parse(match[0]);

      if (json.quality === 'poor' && json.suggestion) {
        const proposal = {
          id: item.id,
          filename: item.slug,
          url: item.source_url,
          currentAltText: altText,
          proposedAltText: json.suggestion,
          reason: json.reason || '',
        };
        proposals.push(proposal);
        if (onProposal) onProposal(proposal);
      }
    } catch (err) {
      if (onError) onError(item.slug, err.message);
    }
  });

  await promisePool(tasks, 3);
  return proposals;
}

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function buildRenameUrlMappings(oldItem, newItem) {
  const mappings = {};
  if (oldItem.source_url && newItem.source_url && oldItem.source_url !== newItem.source_url) {
    mappings[oldItem.source_url] = newItem.source_url;
  }
  const oldSizes = oldItem.media_details?.sizes || {};
  const newSizes = newItem.media_details?.sizes || {};
  for (const [sizeName, oldSizeData] of Object.entries(oldSizes)) {
    if (newSizes[sizeName] && oldSizeData.source_url && oldSizeData.source_url !== newSizes[sizeName].source_url) {
      mappings[oldSizeData.source_url] = newSizes[sizeName].source_url;
    }
  }
  return mappings;
}

export async function updateFeaturedImageReferences(idMap) {
  if (Object.keys(idMap).length === 0) return 0;
  const [posts, pages] = await Promise.all([getPosts({ lang: 'all' }), getPages({ lang: 'all' })]);
  let count = 0;
  for (const item of [...posts, ...pages]) {
    const featuredId = item.featured_media;
    if (featuredId && idMap[featuredId] != null) {
      const fn = item.type === 'page' ? updatePage : updatePost;
      await fn(item.id, { featured_media: idMap[featuredId] });
      count++;
    }
  }
  return count;
}

async function analyzeImageForUpload(buffer, mimeType, originalFilename, siteContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  const base64 = buffer.toString('base64');
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          {
            type: 'text',
            text: `${siteContext ? `Kontext der Webseite:\n${siteContext}\n\n` : ''}Originaler Dateiname: "${originalFilename}"\n\nAnalysiere dieses Bild und generiere SEO-optimierte Metadaten für WordPress auf Deutsch. Antworte ausschließlich mit JSON:\n{"filename":"seo-dateiname-ohne-endung-nur-kleinbuchstaben-und-bindestriche","altText":"beschreibender Alt-Text auf Deutsch","title":"Bildtitel auf Deutsch"}`,
          },
        ],
      }],
    });
    const text = response.content[0]?.text || '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const json = JSON.parse(match[0]);
    return {
      filename: json.filename ? sanitizeFilename(json.filename) : null,
      altText: json.altText || null,
      title: json.title || null,
    };
  } catch {
    return null;
  }
}

export async function uploadFromPC({ buffer, mimeType, originalFilename, postId, postType, mode, oldMediaId, oldSrc, onProgress }) {
  const siteContext = await getSiteContext().catch(() => '');

  if (onProgress) onProgress('Analysiere Bild mit KI…');
  const aiMeta = await analyzeImageForUpload(buffer, mimeType, originalFilename, siteContext);

  const origExt = path.extname(originalFilename);
  const ext = origExt || `.${mimeType.split('/')[1] || 'jpg'}`;
  const baseWithoutExt = originalFilename.replace(/\.[^.]+$/, '');
  const aiFilename = aiMeta?.filename || sanitizeFilename(baseWithoutExt);
  const newFilename = aiFilename + ext;

  if (onProgress) onProgress(`Lade hoch als "${newFilename}"…`);

  const meta = {};
  if (aiMeta?.altText) meta.alt_text = aiMeta.altText;
  if (aiMeta?.title) meta.title = aiMeta.title;

  const newItem = await uploadMedia(buffer, mimeType, newFilename, meta);
  const updatedNewItem = await getMediaItem(newItem.id);

  if (onProgress) onProgress('Aktualisiere Referenzen…');

  // Fetch old media item's full details (all size URLs) before we delete it
  let oldMediaItem = null;
  if (oldMediaId) {
    try { oldMediaItem = await getMediaItem(oldMediaId); } catch {}
  }

  const { replaceImage } = await import('./seasonal-replacer.js');
  await replaceImage({
    postId,
    postType,
    mode,
    oldSrc: oldSrc || oldMediaItem?.source_url || null,
    oldMediaId: oldMediaId || null,
    newMediaId: updatedNewItem.id,
    newSrc: updatedNewItem.source_url,
  });

  // Build full URL mappings (all size variants) so other posts referencing
  // the same image also get updated — replaceImage only touches the one post
  const urlMappings = buildRenameUrlMappings(
    oldMediaItem || { source_url: oldSrc, media_details: {} },
    updatedNewItem,
  );
  if (oldSrc && updatedNewItem.source_url && !urlMappings[oldSrc]) {
    urlMappings[oldSrc] = updatedNewItem.source_url;
  }
  const idMap = oldMediaId ? { [oldMediaId]: updatedNewItem.id } : {};

  if (Object.keys(urlMappings).length > 0) {
    await updateMediaReferences(urlMappings, idMap);
  }
  if (Object.keys(idMap).length > 0) {
    await updateFeaturedImageReferences(idMap);
  }

  if (oldMediaId) {
    if (onProgress) onProgress('Entferne altes Bild…');
    try { await deleteMedia(oldMediaId); } catch {}
  }

  return {
    newId: updatedNewItem.id,
    newSrc: updatedNewItem.source_url,
    thumbnail: updatedNewItem.media_details?.sizes?.medium?.source_url
      || updatedNewItem.media_details?.sizes?.thumbnail?.source_url
      || updatedNewItem.source_url,
    filename: newFilename,
    altText: aiMeta?.altText || null,
    title: aiMeta?.title || null,
  };
}

export async function renameMediaItem(item, newBasename) {
  const sanitized = sanitizeFilename(newBasename);
  const origPath = item.source_url.split('?')[0];
  const ext = path.extname(origPath) || '.jpg';
  const newFilename = sanitized + ext;

  const { buffer, mimeType } = await fetchImageBuffer(item.source_url);
  const newItem = await uploadMedia(buffer, mimeType, newFilename, {
    title: item.title?.rendered || sanitized,
    alt_text: item.alt_text || '',
  });

  const updatedNewItem = await getMediaItem(newItem.id);
  const urlMappings = buildRenameUrlMappings(item, updatedNewItem);

  return {
    originalId: item.id,
    originalUrl: item.source_url,
    originalFilename: item.slug,
    newId: updatedNewItem.id,
    newUrl: updatedNewItem.source_url,
    newFilename: sanitized,
    urlMappings,
  };
}

export async function applyFilenameRenames(changes, { onProgress, onResult, onError } = {}) {
  const allUrlMappings = {};
  const idMap = {};
  const results = [];
  let done = 0;

  for (const { id, newFilename } of changes) {
    done++;
    let item;
    try {
      item = await getMediaItem(id);
      if (onProgress) onProgress(done, changes.length, item.slug);
      const result = await renameMediaItem(item, newFilename);
      Object.assign(allUrlMappings, result.urlMappings);
      idMap[result.originalId] = result.newId;
      results.push({ ...result, success: true });
      if (onResult) onResult({ ...result, success: true });
      await deleteMedia(result.originalId);
    } catch (err) {
      const slug = item?.slug || String(id);
      results.push({ id, success: false, error: err.message });
      if (onError) onError(slug, err.message);
    }
  }

  const [refsUpdated, featuredUpdated] = await Promise.all([
    Object.keys(allUrlMappings).length > 0 ? updateMediaReferences(allUrlMappings, idMap) : Promise.resolve(0),
    Object.keys(idMap).length > 0 ? updateFeaturedImageReferences(idMap) : Promise.resolve(0),
  ]);

  return { results, refsUpdated, featuredUpdated };
}

export async function auditFilenamesWithAI({ onProgress, onProposal, onError } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const client = new Anthropic({ apiKey });
  const [media, siteContext] = await Promise.all([
    getMedia({ media_type: 'image' }),
    getSiteContext().catch(() => ''),
  ]);
  const proposals = [];
  let done = 0;

  const tasks = media.map((item) => async () => {
    const currentSlug = item.slug || '';
    done++;
    if (onProgress) onProgress(done, media.length, currentSlug);

    try {
      const { base64, mimeType } = await fetchImageAsBase64(item.source_url);

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            {
              type: 'text',
              text: `${siteContext ? `Kontext der Webseite:\n${siteContext}\n\n` : ''}Aktueller Dateiname: "${currentSlug}"\n\nBewerte diesen Dateinamen für SEO. Ist er beschreibend und keyword-reich? Generiere bei Bedarf einen besseren Dateinamen (nur Kleinbuchstaben a-z und Ziffern, Bindestriche statt Leerzeichen, keine Umlaute, ohne Dateiformat-Endung). Antworte ausschließlich mit JSON:\n{"quality":"good"|"poor","suggestion":"neuer-dateiname oder null","reason":"ein Satz auf Deutsch"}`,
            },
          ],
        }],
      });

      const text = response.content[0]?.text || '';
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return;
      const json = JSON.parse(match[0]);

      const proposal = {
        id: item.id,
        filename: currentSlug,
        url: item.source_url,
        currentFilename: currentSlug,
        quality: json.quality === 'good' ? 'good' : 'poor',
        proposedFilename: json.quality === 'poor' && json.suggestion ? sanitizeFilename(json.suggestion) : null,
        reason: json.reason || '',
      };
      proposals.push(proposal);
      if (onProposal) onProposal(proposal);
    } catch (err) {
      if (onError) onError(currentSlug, err.message);
    }
  });

  await promisePool(tasks, 3);
  return proposals;
}

export async function auditMedia({ fix = false, output } = {}) {
  log.header('Media Audit');
  log.info('Fetching media library...');

  const media = await getMedia({ media_type: 'image' });
  log.info(`Analyzing ${media.length} images...`);

  const results = [];
  let issueCount = 0;
  let fixedCount = 0;
  let checked_count = 0;

  for (const item of media) {
    checked_count++;
    process.stdout.write(`\r  Analyzing ${checked_count}/${media.length}...`);
    const issues = auditMediaItem(item);
    if (issues.length > 0) {
      issueCount += issues.length;

      const fixedIssues = [];
      if (fix) {
        const missingAlt = issues.find((i) => i === 'Missing alt text');
        if (missingAlt) {
          const altText = generateAltText(item);
          try {
            await updateMedia(item.id, { alt_text: altText });
            fixedIssues.push(`Set alt text: "${altText}"`);
            fixedCount++;
          } catch (err) {
            fixedIssues.push(`Failed to set alt text: ${err.message}`);
          }
        }
      }

      results.push({
        id: item.id,
        filename: item.slug,
        url: item.source_url,
        altText: item.alt_text || null,
        fileSize: item.media_details?.filesize || null,
        width: item.media_details?.width || null,
        height: item.media_details?.height || null,
        issues,
        ...(fixedIssues.length > 0 ? { fixed: fixedIssues } : {}),
      });
    }
  }

  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  if (results.length === 0) {
    log.success('All media items look good.');
  } else {
    log.warn(`Found ${issueCount} issue(s) in ${results.length} media item(s):`);
    for (const item of results) {
      log.row(item.filename.substring(0, 35), item.url, 'yellow');
      for (const issue of item.issues) {
        log.row('', `• ${issue}`, 'dim');
      }
      if (item.fixed) {
        for (const f of item.fixed) {
          log.row('', `✔ ${f}`, 'green');
        }
      }
    }
  }

  if (fix && fixedCount > 0) {
    log.success(`Auto-fixed ${fixedCount} missing alt text(s).`);
  }

  if (output) saveReport(output, {
    summary: { total: media.length, withIssues: results.length, totalIssues: issueCount, autoFixed: fixedCount },
    results,
  });

  return results;
}
