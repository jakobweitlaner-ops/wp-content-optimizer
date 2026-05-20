import { getPosts, getPages, getPage, getPost, getMediaPage, getMediaByIds, updatePost, updatePage } from '../utils/wp-api.js';

function extractContentImages(html) {
  const images = [];
  const imgRe = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(html)) !== null) {
    const src = match[1];
    const classMatch = match[0].match(/wp-image-(\d+)/);
    const uagMatch = match[0].match(/uag-image-(\d+)/);
    const dataMatch = match[0].match(/data-id="(\d+)"/);
    const mediaId = classMatch ? parseInt(classMatch[1], 10)
      : uagMatch ? parseInt(uagMatch[1], 10)
      : dataMatch ? parseInt(dataMatch[1], 10)
      : null;
    images.push({ src, mediaId, raw: match[0] });
  }
  return images;
}

// Deduplicate content images extracted from a post:
// - Same mediaId → keep first occurrence
// - Same base filename (different size variant) → keep the full-size (non-variant) URL
function deduplicateContentImages(images) {
  const seenMediaIds = new Set();
  const seenBases = new Map(); // srcKey → { idx, isVariant }
  const result = [];

  for (const img of images) {
    if (img.mediaId !== null) {
      if (seenMediaIds.has(img.mediaId)) continue;
      seenMediaIds.add(img.mediaId);
    }

    // Strip -scaled and -NNNxMMM suffixes to get a canonical key
    const srcKey = img.src.replace(/(-scaled)?(-\d+x\d+)?\.[^./]+$/, '');
    const filename = img.src.split('?')[0].split('/').pop();
    const isVariant = /(-scaled|-\d+x\d+)\.[^./]+$/.test(filename);

    if (seenBases.has(srcKey)) {
      const prev = seenBases.get(srcKey);
      // Upgrade: replace a size-variant entry with the full-size version
      if (prev.isVariant && !isVariant) {
        result[prev.idx] = img;
        prev.isVariant = false;
      }
      continue;
    }
    seenBases.set(srcKey, { idx: result.length, isVariant });
    result.push(img);
  }
  return result;
}

// Group items so that pages/posts with shared translation IDs appear consecutively.
function groupByTranslations(items) {
  const byId = new Map(items.map(i => [i.id, i]));
  const visited = new Set();
  const grouped = [];

  for (const item of items) {
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    const group = [item];

    if (item.translations && typeof item.translations === 'object') {
      for (const translatedId of Object.values(item.translations)) {
        if (translatedId !== item.id && byId.has(translatedId) && !visited.has(translatedId)) {
          visited.add(translatedId);
          group.push(byId.get(translatedId));
        }
      }
    }

    grouped.push(...group);
  }

  return grouped;
}

export async function getPostsWithImages({ onPost } = {}) {
  // Step 1: fetch basic post info without content (fast)
  // lang=all fetches posts/pages in every Polylang language (ignored on non-Polylang sites)
  const [posts, pages] = await Promise.all([
    getPosts({ _fields: 'id,title,link,featured_media,translations', lang: 'all' }),
    getPages({ _fields: 'id,title,link,featured_media,translations', lang: 'all' }),
  ]);

  // Deduplicate by id across posts+pages and within each list
  const seen = new Set();
  const allItems = [];
  for (const item of [...pages.map(p => ({ ...p, type: 'page' })), ...posts.map(p => ({ ...p, type: 'post' }))]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      allItems.push(item);
    }
  }

  // Group translated pages/posts so they appear consecutively
  const sortedItems = groupByTranslations(allItems);

  // Step 2: resolve featured image URLs in bulk (no content needed yet)
  const featuredIds = [...new Set(
    sortedItems.filter(i => i.featured_media > 0).map(i => i.featured_media)
  )];
  const featuredUrlMap = {};
  if (featuredIds.length > 0) {
    try {
      const mediaItems = await getMediaByIds(featuredIds);
      for (const m of mediaItems) {
        featuredUrlMap[String(m.id)] = m.media_details?.sizes?.medium?.source_url
          || m.media_details?.sizes?.thumbnail?.source_url
          || m.source_url;
      }
    } catch (err) {
      console.error('[seasonal] getMediaByIds failed:', err.message);
    }
  }

  // Step 3: fetch content per-item in batches of 10 to extract embedded images
  const BATCH = 10;
  const results = [];

  for (let i = 0; i < sortedItems.length; i += BATCH) {
    const batch = sortedItems.slice(i, i + BATCH);

    const batchResults = await Promise.all(batch.map(async (item) => {
      const images = [];

      if (item.featured_media > 0) {
        images.push({
          slot: 'featured',
          label: 'Beitragsbild',
          mediaId: item.featured_media,
          src: featuredUrlMap[String(item.featured_media)] || null,
        });
      }

      // Fetch full content only for this item (parallelised within the batch)
      let contentImages = [];
      try {
        const getFn = item.type === 'page' ? getPage : getPost;
        const full = await getFn(item.id, { _fields: 'content', context: 'edit' });
        // Prefer raw content to match what replaceImage() will modify
        contentImages = deduplicateContentImages(
          extractContentImages(full.content?.raw || full.content?.rendered || '')
        );
        for (const img of contentImages) {
          // contentSrc preserves the URL as it appears in the actual content —
          // used as oldSrc for replacement so it always matches the stored HTML.
          images.push({ slot: 'content', label: 'Inhaltsbild', mediaId: img.mediaId, src: img.src, contentSrc: img.src, raw: img.raw });
        }
      } catch {
        // content unavailable – featured image still shown
      }

      if (images.length === 0) return null;

      return {
        id: item.id,
        type: item.type,
        title: item.title?.rendered || `(ID ${item.id})`,
        url: item.link,
        images,
      };
    }));

    // For content images with a known mediaId, resolve the thumbnail URL directly
    // from the media library — this guarantees a fresh, correct preview URL even
    // when the stored HTML src points to an outdated or domain-mismatched URL.
    const batchEntries = batchResults.filter(Boolean);
    const contentMediaIds = [...new Set(
      batchEntries.flatMap(e => e.images
        .filter(img => img.slot === 'content' && img.mediaId)
        .map(img => img.mediaId)
      )
    )];

    if (contentMediaIds.length > 0) {
      try {
        const mediaItems = await getMediaByIds(contentMediaIds);
        const contentUrlMap = {};
        for (const m of mediaItems) {
          contentUrlMap[String(m.id)] = m.media_details?.sizes?.medium?.source_url
            || m.media_details?.sizes?.thumbnail?.source_url
            || m.source_url;
        }
        for (const entry of batchEntries) {
          for (const img of entry.images) {
            if (img.slot === 'content' && img.mediaId && contentUrlMap[String(img.mediaId)]) {
              img.src = contentUrlMap[String(img.mediaId)];
            }
          }
        }
      } catch {}
    }

    for (const entry of batchEntries) {
      results.push(entry);
      if (onPost) onPost(entry);
    }
  }

  return results;
}

export async function replaceImage({ postId, postType, mode, oldSrc, oldMediaId, newMediaId, newSrc, urlMappings = {} }) {
  const wpApi = await import('../utils/wp-api.js');
  const getItem = postType === 'page' ? wpApi.getPage : wpApi.getPost;
  const updateItem = postType === 'page' ? updatePage : updatePost;

  if (mode === 'featured') {
    await updateItem(postId, { featured_media: newMediaId });
    return { success: true };
  }

  const item = await getItem(postId, { context: 'edit' });
  const rawContent = item.content?.raw || item.content?.rendered || '';

  if (!oldSrc) throw new Error('oldSrc required for content image replacement');

  // Replace the primary src URL — try exact match first, then path-based fallback
  // (fallback handles http↔https and domain mismatches between stored URL and WP_URL env)
  // Also matches any size variant sharing the same base filename (e.g. rendered -300x200 vs
  // stored -1024x683), since WordPress may store a different size than what is rendered.
  // Strip WordPress size/scaled suffixes for base-path comparison (e.g. -300x200, -scaled, -scaled-300x200)
  const stripSizeSuffix = (pathname) => pathname.replace(/(-scaled)?(-\d+x\d+)?\.[^./]+$/, '');

  let finalContent = rawContent;
  if (rawContent.includes(oldSrc)) {
    // Use the size-appropriate mapped URL when oldSrc appears in a srcset slot,
    // so a 300w entry is replaced with the new 300w variant, not the full-size image.
    const mappedOldSrc = urlMappings[oldSrc] ?? newSrc;
    finalContent = rawContent.split(oldSrc).join(mappedOldSrc);
  } else {
    try {
      const oldPath = new URL(oldSrc).pathname;
      const oldBase = stripSizeSuffix(oldPath);
      finalContent = rawContent.replace(
        /https?:\/\/[^\s"'>]+\/wp-content\/uploads\/[^\s"'>]+/g,
        (url) => {
          try {
            const p = new URL(url).pathname;
            if (p === oldPath) return newSrc;
            if (stripSizeSuffix(p) === oldBase) return newSrc;
            return url;
          } catch { return url; }
        },
      );
    } catch {}
    if (finalContent === rawContent) throw new Error('Bild-URL nicht im Inhalt gefunden');
  }

  // Replace wp-image-ID class and Gutenberg block "id" attribute
  // Use regex (not string split) to avoid matching IDs that are prefixes of longer IDs
  // e.g. replacing wp-image-12 must NOT corrupt wp-image-1234
  if (oldMediaId && newMediaId) {
    finalContent = finalContent
      .replace(new RegExp(`\\bwp-image-${oldMediaId}\\b`, 'g'), `wp-image-${newMediaId}`)
      .replace(new RegExp(`\\buag-image-${oldMediaId}\\b`, 'g'), `uag-image-${newMediaId}`)
      .replace(new RegExp(`"id":${oldMediaId}(?!\\d)`, 'g'), `"id":${newMediaId}`)
      .replace(new RegExp(`"id": ${oldMediaId}(?!\\d)`, 'g'), `"id": ${newMediaId}`);
  }

  // Replace all remaining upload URLs (srcset size variants etc.) using path-based lookup.
  // urlMappings contains old→new URL pairs for all size variants of the replaced image,
  // enabling domain-independent replacement of every mobile/responsive srcset URL.
  const pathToNewUrl = {};
  for (const [oldUrl, newUrl] of Object.entries(urlMappings)) {
    try { pathToNewUrl[new URL(oldUrl).pathname] = newUrl; } catch {}
  }
  // Always ensure oldSrc → newSrc is covered even if not in urlMappings
  try {
    const oldPath = new URL(oldSrc).pathname;
    if (!pathToNewUrl[oldPath]) pathToNewUrl[oldPath] = newSrc;
  } catch {}

  // Compute base path of oldSrc (strip -scaled and dimension suffixes e.g. -1024x683)
  // so that size variants not listed in urlMappings are still caught (srcset fallback)
  let oldBasePath = null;
  try {
    oldBasePath = stripSizeSuffix(new URL(oldSrc).pathname);
  } catch {}

  if (Object.keys(pathToNewUrl).length > 0 || oldBasePath) {
    finalContent = finalContent.replace(
      /https?:\/\/[^\s"'>]+\/wp-content\/uploads\/[^\s"'>]+/g,
      (url) => {
        try {
          const urlObj = new URL(url);
          const mapped = pathToNewUrl[urlObj.pathname];
          if (mapped) return mapped;
          // Fall back: replace any size variant sharing the same base filename
          if (oldBasePath && stripSizeSuffix(urlObj.pathname) === oldBasePath) {
            return newSrc;
          }
          return url;
        } catch { return url; }
      },
    );
  }

  // Final pass: clean up orphaned upload URLs inside the same <img> tag as newSrc.
  // These are stale entries left by a previous partial replacement (e.g. IMG_0073-scaled.jpeg
  // remaining as 780w/360w srcset entries after the src was already updated to the new image).
  // Any upload URL in the updated img tag whose base path differs from newSrc is replaced with newSrc.
  // stripSizeSuffix handles WordPress -scaled images so that new-image-300x200.jpg is correctly
  // recognised as a size variant of new-image-scaled.jpg (same base: new-image).
  let newBasePath = null;
  try { newBasePath = stripSizeSuffix(new URL(newSrc).pathname); } catch {}

  if (newBasePath) {
    finalContent = finalContent.replace(/<img[^>]+>/gs, (imgTag) => {
      if (!imgTag.includes(newSrc)) return imgTag;
      return imgTag.replace(
        /https?:\/\/[^\s"'>]+\/wp-content\/uploads\/[^\s"'>]+/g,
        (url) => {
          try {
            const p = new URL(url).pathname;
            // Keep if already in our mappings or shares the new image's base path
            if (pathToNewUrl[p]) return pathToNewUrl[p];
            if (stripSizeSuffix(p) === newBasePath) return url;
            // Orphaned URL from a previous replacement — replace with full-size new image
            return newSrc;
          } catch { return url; }
        },
      );
    });
  }

  await updateItem(postId, { content: finalContent });
  return { success: true };
}

export async function getMediaLibrary({ page = 1, perPage = 30, search = '' } = {}) {
  const params = { media_type: 'image', per_page: perPage, page };
  if (search) params.search = search;

  const items = await getMediaPage(params);
  return items.map((m) => ({
    id: m.id,
    title: m.title?.rendered || m.slug,
    filename: m.source_url ? m.source_url.split('/').pop() : (m.slug || ''),
    slug: m.slug,
    src: m.source_url,
    thumbnail: m.media_details?.sizes?.thumbnail?.source_url || m.source_url,
    medium: m.media_details?.sizes?.medium?.source_url || m.source_url,
    width: m.media_details?.width,
    height: m.media_details?.height,
    altText: m.alt_text || '',
  }));
}
