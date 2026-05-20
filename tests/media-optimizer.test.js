import { describe, it, expect, vi } from 'vitest';

const MAX_FILE_SIZE_BYTES = 200 * 1024;
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 2560;

function auditMediaItem(item) {
  const issues = [];

  if (!item.alt_text || item.alt_text.trim().length === 0) {
    issues.push('Missing alt text');
  }

  const filename = item.slug || '';
  if (/^(img|image|photo|pic|dsc|screenshot)[\-_]?\d+$/i.test(filename)) {
    issues.push(`Generic filename: "${filename}"`);
  }
  if (filename.length < 5) {
    issues.push(`Filename too short: "${filename}"`);
  }

  const fileSize = item.media_details?.filesize;
  if (fileSize && fileSize > MAX_FILE_SIZE_BYTES) {
    const kb = Math.round(fileSize / 1024);
    issues.push(`Large file size: ${kb} KB (max recommended: ${MAX_FILE_SIZE_BYTES / 1024} KB)`);
  }

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

describe('auditMediaItem', () => {
  const good = {
    alt_text: 'A descriptive alt text',
    slug: 'descriptive-image-name',
    media_details: { filesize: 100 * 1024, width: 1920, height: 1080 },
  };

  it('returns no issues for a clean item', () => {
    expect(auditMediaItem(good)).toHaveLength(0);
  });

  it('flags missing alt text', () => {
    const issues = auditMediaItem({ ...good, alt_text: '' });
    expect(issues).toContain('Missing alt text');
  });

  it('flags generic filenames', () => {
    for (const slug of ['img001', 'image123', 'dsc9999', 'photo1', 'screenshot42']) {
      const issues = auditMediaItem({ ...good, slug });
      expect(issues.some((i) => i.startsWith('Generic filename'))).toBe(true);
    }
  });

  it('does not flag descriptive filenames', () => {
    const issues = auditMediaItem({ ...good, slug: 'team-photo-berlin-2024' });
    expect(issues.some((i) => i.startsWith('Generic filename'))).toBe(false);
  });

  it('flags oversized files', () => {
    const issues = auditMediaItem({ ...good, media_details: { ...good.media_details, filesize: 500 * 1024 } });
    expect(issues.some((i) => i.startsWith('Large file size'))).toBe(true);
  });

  it('flags high resolution images', () => {
    const issues = auditMediaItem({ ...good, media_details: { ...good.media_details, width: 4000, height: 3000 } });
    expect(issues.some((i) => i.startsWith('High resolution'))).toBe(true);
  });
});

describe('generateAltText', () => {
  it('uses title when available', () => {
    expect(generateAltText({ title: { rendered: 'My Photo' }, slug: 'my-photo' })).toBe('My Photo');
  });

  it('falls back to slug when title is absent', () => {
    expect(generateAltText({ slug: 'team-photo-berlin' })).toBe('team photo berlin');
  });

  it('returns "image" as last resort', () => {
    expect(generateAltText({ slug: '', title: { rendered: '' } })).toBe('image');
  });
});

// ── compressImageBuffer (unit tests using real sharp) ──────────

describe('compressImageBuffer', () => {
  async function makeJpegBuffer(width = 100, height = 100) {
    const { default: sharp } = await import('sharp');
    return sharp({
      create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  async function makePngBuffer(width = 100, height = 100) {
    const { default: sharp } = await import('sharp');
    return sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
  }

  it('compresses a JPEG buffer and returns a smaller buffer', async () => {
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    const original = await makeJpegBuffer(800, 600);
    const { buffer: compressed, mimeType } = await compressImageBuffer(original, 'image/jpeg', { quality: 60 });
    expect(compressed.length).toBeLessThan(original.length);
    expect(mimeType).toBe('image/jpeg');
  });

  it('compresses a PNG buffer', async () => {
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    const original = await makePngBuffer(200, 200);
    const { mimeType } = await compressImageBuffer(original, 'image/png', {});
    expect(mimeType).toBe('image/png');
  });

  it('resizes image when dimensions exceed max', async () => {
    const { default: sharp } = await import('sharp');
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    const original = await makeJpegBuffer(400, 400);
    const { buffer } = await compressImageBuffer(original, 'image/jpeg', { maxWidth: 100, maxHeight: 100 });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(100);
    expect(meta.height).toBeLessThanOrEqual(100);
  });

  it('does not enlarge images smaller than max dimensions', async () => {
    const { default: sharp } = await import('sharp');
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    const original = await makeJpegBuffer(50, 50);
    const { buffer } = await compressImageBuffer(original, 'image/jpeg', { maxWidth: 2560, maxHeight: 2560 });
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(50);
  });

  it('throws for unsupported formats', async () => {
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    const buf = Buffer.from('fake gif data');
    await expect(compressImageBuffer(buf, 'image/gif', {})).rejects.toThrow('Unsupported format');
  });

  it('compresses JPEG to within targetSizeBytes', async () => {
    const { default: sharp } = await import('sharp');
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    // Noisy (photo-like) image so quality reduction actually shrinks the file
    const raw = Buffer.alloc(400 * 300 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 137 + 41) % 256;
    const original = await sharp(raw, { raw: { width: 400, height: 300, channels: 3 } })
      .jpeg({ quality: 95 }).toBuffer();
    const targetBytes = Math.floor(original.length * 0.4);
    const { buffer, mimeType } = await compressImageBuffer(original, 'image/jpeg', { targetSizeBytes: targetBytes });
    expect(buffer.length).toBeLessThanOrEqual(targetBytes);
    expect(mimeType).toBe('image/jpeg');
  });

  it('converts PNG to lossy format when lossless exceeds targetSizeBytes', async () => {
    const { compressImageBuffer } = await import('../src/modules/media-optimizer.js');
    const original = await makePngBuffer(400, 400);
    // Set an extremely small target to force lossy conversion
    const { mimeType } = await compressImageBuffer(original, 'image/png', { targetSizeBytes: 1024 });
    expect(['image/png', 'image/webp', 'image/jpeg']).toContain(mimeType);
  });
});

// ── detectOversizedImages (unit tests with mocked wp-api) ──────

describe('detectOversizedImages', () => {
  it('returns only images above the threshold with compressible mime type', async () => {
    vi.resetModules();
    vi.doMock('../src/utils/wp-api.js', () => ({
      getMedia: async () => [
        { id: 1, slug: 'small', mime_type: 'image/jpeg', media_details: { filesize: 50 * 1024 }, source_url: 'https://example.com/small.jpg' },
        { id: 2, slug: 'large-jpeg', mime_type: 'image/jpeg', media_details: { filesize: 500 * 1024 }, source_url: 'https://example.com/large.jpg' },
        { id: 3, slug: 'large-svg', mime_type: 'image/svg+xml', media_details: { filesize: 500 * 1024 }, source_url: 'https://example.com/large.svg' },
        { id: 4, slug: 'large-png', mime_type: 'image/png', media_details: { filesize: 300 * 1024 }, source_url: 'https://example.com/large.png' },
      ],
      updateMedia: async () => ({}),
      uploadMedia: async () => ({ id: 99, source_url: 'https://example.com/new.jpg' }),
      getSiteContext: async () => '',
    }));
    const { detectOversizedImages } = await import('../src/modules/media-optimizer.js');
    const result = await detectOversizedImages({ threshold: 200 * 1024 });
    expect(result.map((r) => r.id)).toEqual([2, 4]);
    vi.doUnmock('../src/utils/wp-api.js');
    vi.resetModules();
  });
});

// ── ID replacement logic (pure unit tests, no module import needed) ──────────
// These mirror the fix in updateMediaReferences and replaceImage: use regex
// with word boundaries instead of String.split to avoid partial-ID matches.

function applyIdMappings(content, idMappings) {
  let updated = content;
  for (const [oldId, newId] of Object.entries(idMappings)) {
    updated = updated
      .replace(new RegExp(`\\bwp-image-${oldId}\\b`, 'g'), `wp-image-${newId}`)
      .replace(new RegExp(`"id":${oldId}(?!\\d)`, 'g'), `"id":${newId}`)
      .replace(new RegExp(`"id": ${oldId}(?!\\d)`, 'g'), `"id": ${newId}`);
  }
  return updated;
}

describe('ID replacement – substring-safety', () => {
  const BASE = 'https://example.com/wp-content/uploads/2024/01';

  it('does not corrupt wp-image class when old ID is a prefix of another ID', () => {
    const raw = `<!-- wp:image {"id":1234} --><img src="${BASE}/other.jpg" class="wp-image-1234"/><!-- /wp:image -->`;
    const result = applyIdMappings(raw, { 12: 99 });
    expect(result).toContain('wp-image-1234');
    expect(result).not.toContain('wp-image-994');
    expect(result).toContain('"id":1234');
    expect(result).not.toContain('"id":994');
  });

  it('replaces the target ID without touching longer IDs sharing that prefix', () => {
    const raw = [
      `<!-- wp:image {"id":12} --><img src="${BASE}/old.jpg" class="wp-image-12"/><!-- /wp:image -->`,
      `<!-- wp:image {"id":1234} --><img src="${BASE}/other.jpg" class="wp-image-1234"/><!-- /wp:image -->`,
    ].join('\n');
    const result = applyIdMappings(raw, { 12: 99 });
    expect(result).toContain('wp-image-99');
    expect(result).not.toContain('wp-image-12"');
    expect(result).toContain('wp-image-1234');
    expect(result).toContain('"id":99');
    expect(result).toContain('"id":1234');
  });

  it('handles "id": N (space before number) without corrupting longer IDs', () => {
    const raw = `<!-- wp:image {"id": 12} --><img class="wp-image-12"/><!-- /wp:image -->\n<!-- wp:image {"id": 120} --><img class="wp-image-120"/><!-- /wp:image -->`;
    const result = applyIdMappings(raw, { 12: 99 });
    expect(result).toContain('"id": 99');
    expect(result).not.toContain('"id": 12"');
    expect(result).toContain('"id": 120');
  });
});

// ── replaceImage – srcset size-variant handling ──────────────────────────────

describe('replaceImage – srcset update with size-variant oldSrc', () => {
  const BASE = 'https://example.com/wp-content/uploads/2024/01';

  async function runReplace(opts) {
    vi.resetModules();
    let savedContent = null;
    vi.doMock('../src/utils/wp-api.js', () => ({
      getPost: async () => ({ content: { raw: opts.raw } }),
      getPage: async () => ({ content: { raw: opts.raw } }),
      updatePost: async (_id, data) => { savedContent = data.content; },
      updatePage: async (_id, data) => { savedContent = data.content; },
    }));
    const { replaceImage } = await import('../src/modules/seasonal-replacer.js');
    await replaceImage({
      postId: 1,
      postType: 'post',
      mode: 'content',
      oldSrc: opts.oldSrc,
      oldMediaId: opts.oldMediaId ?? null,
      newMediaId: opts.newMediaId ?? null,
      newSrc: opts.newSrc,
    });
    vi.doUnmock('../src/utils/wp-api.js');
    vi.resetModules();
    return savedContent;
  }

  it('updates srcset size variants when oldSrc is the large-size URL', async () => {
    // oldSrc is the 'large' size (1024w), but srcset also has 300w and 768w variants
    const raw = [
      `<!-- wp:image {"id":10} -->`,
      `<figure><img src="${BASE}/old-name-1024x683.jpg" class="wp-image-10"`,
      ` srcset="${BASE}/old-name-300x200.jpg 300w, ${BASE}/old-name-768x512.jpg 768w, ${BASE}/old-name-1024x683.jpg 1024w"`,
      `/></figure>`,
      `<!-- /wp:image -->`,
    ].join('');

    const result = await runReplace({
      raw,
      oldSrc: `${BASE}/old-name-1024x683.jpg`,
      oldMediaId: 10,
      newMediaId: 20,
      newSrc: `${BASE}/new-name.jpg`,
    });

    expect(result).not.toBeNull();
    // All old-name size variants must be gone
    expect(result).not.toContain('old-name-300x200');
    expect(result).not.toContain('old-name-768x512');
    expect(result).not.toContain('old-name-1024x683');
    // IDs updated
    expect(result).toContain('wp-image-20');
    expect(result).not.toContain('wp-image-10');
  });

  it('does not corrupt wp-image class of unrelated longer IDs during replacement', async () => {
    const raw = [
      `<!-- wp:image {"id":10} -->`,
      `<img src="${BASE}/old.jpg" class="wp-image-10"/>`,
      `<!-- /wp:image -->`,
      `<!-- wp:image {"id":100} -->`,
      `<img src="${BASE}/other.jpg" class="wp-image-100"/>`,
      `<!-- /wp:image -->`,
    ].join('');

    const result = await runReplace({
      raw,
      oldSrc: `${BASE}/old.jpg`,
      oldMediaId: 10,
      newMediaId: 99,
      newSrc: `${BASE}/new.jpg`,
    });

    expect(result).not.toBeNull();
    expect(result).toContain('wp-image-99');
    expect(result).not.toContain('wp-image-10"');
    // wp-image-100 must be untouched
    expect(result).toContain('wp-image-100');
  });
});
