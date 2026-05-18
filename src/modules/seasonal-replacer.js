import { getPosts, getPages, getMediaPage, getMediaByIds, updatePost, updatePage } from '../utils/wp-api.js';

function extractContentImages(html) {
  const images = [];
  const imgRe = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(html)) !== null) {
    const src = match[1];
    const classMatch = match[0].match(/wp-image-(\d+)/);
    const dataMatch = match[0].match(/data-id="(\d+)"/);
    const mediaId = classMatch ? parseInt(classMatch[1], 10)
      : dataMatch ? parseInt(dataMatch[1], 10)
      : null;
    images.push({ src, mediaId, raw: match[0] });
  }
  return images;
}

export async function getPostsWithImages() {
  const [posts, pages] = await Promise.all([
    getPosts({ _fields: 'id,title,link,content,featured_media', per_page: 100 }),
    getPages({ _fields: 'id,title,link,content,featured_media', per_page: 100 }),
  ]);

  // Deduplicate by id across posts+pages and within each list
  const seen = new Set();
  const allItems = [];
  for (const item of [...posts.map(p => ({ ...p, type: 'post' })), ...pages.map(p => ({ ...p, type: 'page' }))]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      allItems.push(item);
    }
  }

  const results = [];

  for (const item of allItems) {
    const content = item.content?.rendered || '';
    const contentImages = extractContentImages(content);
    const images = [];

    if (item.featured_media && item.featured_media > 0) {
      images.push({
        slot: 'featured',
        label: 'Beitragsbild',
        mediaId: item.featured_media,
        src: null,
      });
    }

    for (const img of contentImages) {
      images.push({
        slot: 'content',
        label: 'Inhaltsbild',
        mediaId: img.mediaId,
        src: img.src,
        raw: img.raw,
      });
    }

    if (images.length > 0) {
      results.push({
        id: item.id,
        type: item.type,
        title: item.title?.rendered || `(ID ${item.id})`,
        url: item.link,
        images,
      });
    }
  }

  // Resolve featured image URLs via batch request
  const featuredIds = [...new Set(
    results.flatMap(p => p.images.filter(i => i.slot === 'featured' && i.mediaId).map(i => i.mediaId))
  )];

  if (featuredIds.length > 0) {
    try {
      const mediaItems = await getMediaByIds(featuredIds);
      const urlMap = {};
      for (const m of mediaItems) {
        // Use medium size if available, else full size
        urlMap[String(m.id)] = m.media_details?.sizes?.medium?.source_url
          || m.media_details?.sizes?.thumbnail?.source_url
          || m.source_url;
      }
      for (const post of results) {
        for (const img of post.images) {
          if (img.slot === 'featured' && img.mediaId) {
            const resolved = urlMap[String(img.mediaId)];
            if (resolved) img.src = resolved;
          }
        }
      }
    } catch (err) {
      console.error('[seasonal] getMediaByIds failed:', err.message);
    }
  }

  return results;
}

export async function replaceImage({ postId, postType, mode, oldSrc, oldMediaId, newMediaId, newSrc }) {
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

  const updated = rawContent.split(oldSrc).join(newSrc);
  if (updated === rawContent) throw new Error(`Bild-URL nicht im Inhalt gefunden`);

  let finalContent = updated;
  if (oldMediaId && newMediaId) {
    finalContent = finalContent.split(`wp-image-${oldMediaId}`).join(`wp-image-${newMediaId}`);
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
    slug: m.slug,
    src: m.source_url,
    thumbnail: m.media_details?.sizes?.thumbnail?.source_url || m.source_url,
    medium: m.media_details?.sizes?.medium?.source_url || m.source_url,
    width: m.media_details?.width,
    height: m.media_details?.height,
    altText: m.alt_text || '',
  }));
}
