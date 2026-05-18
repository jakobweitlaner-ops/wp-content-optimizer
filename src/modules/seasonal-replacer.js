import { getPosts, getPages, getMedia, getMediaPage, updatePost, updatePage } from '../utils/wp-api.js';

/**
 * Extract all image URLs embedded in HTML content.
 * Returns array of { src, mediaId } objects.
 */
function extractContentImages(html) {
  const images = [];
  const imgRe = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(html)) !== null) {
    const src = match[1];
    // Try to extract wp media id from class or data attribute
    const classMatch = match[0].match(/wp-image-(\d+)/);
    const dataMatch = match[0].match(/data-id="(\d+)"/);
    const mediaId = classMatch ? parseInt(classMatch[1], 10)
      : dataMatch ? parseInt(dataMatch[1], 10)
      : null;
    images.push({ src, mediaId, raw: match[0] });
  }
  return images;
}

/**
 * Get all posts and pages with their embedded images (content + featured).
 */
export async function getPostsWithImages() {
  const [posts, pages] = await Promise.all([
    getPosts({ _fields: 'id,title,link,content,featured_media,status', per_page: 100 }),
    getPages({ _fields: 'id,title,link,content,featured_media,status', per_page: 100 }),
  ]);

  const results = [];

  for (const item of [...posts.map(p => ({ ...p, type: 'post' })), ...pages.map(p => ({ ...p, type: 'page' }))]) {
    const content = item.content?.rendered || '';
    const contentImages = extractContentImages(content);

    const images = [];

    // Featured image
    if (item.featured_media && item.featured_media > 0) {
      images.push({
        slot: 'featured',
        label: 'Beitragsbild',
        mediaId: item.featured_media,
        src: null, // resolved separately via media endpoint
      });
    }

    // Content images
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

  return results;
}

/**
 * Replace an image in a post or page.
 *
 * mode: 'featured' → update featured_media field
 * mode: 'content'  → replace src URL in content HTML
 */
export async function replaceImage({ postId, postType, mode, oldSrc, oldMediaId, newMediaId, newSrc }) {
  const getItem = postType === 'page'
    ? (await import('../utils/wp-api.js')).getPage
    : (await import('../utils/wp-api.js')).getPost;
  const updateItem = postType === 'page' ? updatePage : updatePost;

  if (mode === 'featured') {
    await updateItem(postId, { featured_media: newMediaId });
    return { success: true };
  }

  // content replacement
  const item = await getItem(postId, { context: 'edit' });
  const rawContent = item.content?.raw || item.content?.rendered || '';

  if (!oldSrc) throw new Error('oldSrc required for content image replacement');

  // Replace all occurrences of old URL in content
  const updated = rawContent.split(oldSrc).join(newSrc);

  if (updated === rawContent) {
    // Also try replacing in rendered and re-encode
    throw new Error(`Bild-URL "${oldSrc}" nicht im Inhalt gefunden`);
  }

  // Also update wp-image class if we have old media id
  let finalContent = updated;
  if (oldMediaId && newMediaId) {
    finalContent = finalContent.split(`wp-image-${oldMediaId}`).join(`wp-image-${newMediaId}`);
  }

  await updateItem(postId, { content: finalContent });
  return { success: true };
}

/**
 * Get media library items for the image picker (paginated, single page).
 */
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
