import { describe, it, expect } from 'vitest';

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
