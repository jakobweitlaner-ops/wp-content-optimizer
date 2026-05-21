import axios from 'axios';
import https from 'https';

const BASE_URL = process.env.WP_URL;
const USERNAME = process.env.WP_USERNAME;
const APP_PASSWORD = process.env.WP_APP_PASSWORD;
const TIMEOUT = parseInt(process.env.TIMEOUT || '120000', 10);
const INSECURE = process.env.WP_INSECURE === 'true';

function getAuthHeader() {
  const token = Buffer.from(`${USERNAME}:${APP_PASSWORD}`).toString('base64');
  return `Basic ${token}`;
}

const client = axios.create({
  baseURL: `${BASE_URL}/wp-json/wp/v2`,
  timeout: TIMEOUT,
  headers: {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
  },
  httpsAgent: new https.Agent({ rejectUnauthorized: !INSECURE }),
});

export async function getSiteInfo() {
  const { data } = await axios.get(`${BASE_URL}/wp-json/`, {
    httpsAgent: new https.Agent({ rejectUnauthorized: !INSECURE }),
    timeout: TIMEOUT,
  });
  return {
    name: data.name || '',
    description: data.description || '',
    url: BASE_URL,
  };
}

export async function getSiteContext() {
  const [info, pages, posts, categories] = await Promise.allSettled([
    getSiteInfo(),
    fetchAllPages('/pages', { status: 'publish', _fields: 'title' }),
    fetchAllPages('/posts', { status: 'publish', _fields: 'title', per_page: 20 }),
    fetchAllPages('/categories', { _fields: 'name,count', per_page: 50 }),
  ]);

  const site = info.status === 'fulfilled' ? info.value : {};
  const pageNames = pages.status === 'fulfilled'
    ? pages.value.map((p) => p.title?.rendered).filter(Boolean)
    : [];
  const postNames = posts.status === 'fulfilled'
    ? posts.value.map((p) => p.title?.rendered).filter(Boolean)
    : [];
  const cats = categories.status === 'fulfilled'
    ? categories.value.filter((c) => c.count > 0).map((c) => c.name)
    : [];

  const businessType = process.env.SITE_TYPE || '';
  const lines = [];
  if (site.name) lines.push(`Website: ${site.name}`);
  if (businessType) lines.push(`Art des Unternehmens: ${businessType}`);
  const cleanDesc = (site.description || '').replace(/wellness/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (cleanDesc) lines.push(`Beschreibung: ${cleanDesc}`);
  if (site.url) lines.push(`URL: ${site.url}`);
  const filteredCats = cats.filter((c) => !/wellness/i.test(c));
  if (filteredCats.length) lines.push(`Themen: ${filteredCats.join(', ')}`);
  if (pageNames.length) lines.push(`Seiten: ${pageNames.join(', ')}`);
  if (postNames.length) lines.push(`Aktuelle Beiträge: ${postNames.slice(0, 10).join(', ')}`);

  return lines.join('\n');
}

export async function testConnection() {
  if (!BASE_URL || !USERNAME || !APP_PASSWORD) {
    throw new Error('Missing required environment variables: WP_URL, WP_USERNAME, WP_APP_PASSWORD');
  }

  const { data } = await client.get('/users/me');
  const { log } = await import('./logger.js');
  log.success(`Connected as "${data.name}" (${data.email}) to ${BASE_URL}`);
  return data;
}

async function fetchAllPages(endpoint, params = {}) {
  const results = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await withRetry(
      () => client.get(endpoint, { params: { ...params, per_page: 100, page } }),
      3, 1000,
    );
    results.push(...response.data);
    totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
    page++;
  } while (page <= totalPages);

  return results;
}

export async function getPosts(params = {}) {
  return fetchAllPages('/posts', { status: 'publish', context: 'edit', ...params });
}

export async function getPages(params = {}) {
  return fetchAllPages('/pages', { status: 'publish', context: 'edit', ...params });
}

export async function getMedia(params = {}) {
  return fetchAllPages('/media', params);
}

export async function getMediaPage(params = {}) {
  const response = await client.get('/media', { params: { per_page: 30, ...params } });
  return response.data;
}

export async function getMediaByIds(ids) {
  if (!ids.length) return [];
  // WordPress caps per_page at 100 — chunk requests to handle larger sets
  const CHUNK = 100;
  const results = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const qs = chunk.map(id => `include[]=${encodeURIComponent(id)}`).join('&');
    const response = await withRetry(
      () => client.get(`/media?per_page=${chunk.length}&${qs}`),
      3, 1000,
    );
    results.push(...response.data);
  }
  return results;
}

export async function getPost(id, params = {}) {
  const { data } = await withRetry(() => client.get(`/posts/${id}`, { params }), 3, 1000);
  return data;
}

export async function getPage(id, params = {}) {
  const { data } = await withRetry(() => client.get(`/pages/${id}`, { params }), 3, 1000);
  return data;
}

export async function updatePost(id, data) {
  const response = await client.put(`/posts/${id}`, data);
  return response.data;
}

export async function updatePage(id, data) {
  const response = await client.put(`/pages/${id}`, data);
  return response.data;
}

export async function updateMedia(id, data) {
  const response = await client.put(`/media/${id}`, data);
  return response.data;
}

export async function getMediaItem(id) {
  const { data } = await client.get(`/media/${id}`);
  return data;
}

export async function replaceMedia(id, buffer, mimeType) {
  const response = await withRetry(() => axios.post(
    `${BASE_URL}/wp-json/wp-optimizer/v1/media/${id}/replace`,
    buffer,
    {
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': mimeType,
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: !INSECURE }),
      timeout: TIMEOUT,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    },
  ));
  return response.data;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

async function withRetry(fn, retries = 4, delay = 2000) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (attempt >= retries || !RETRYABLE.has(status)) throw err;
      await new Promise(r => setTimeout(r, delay * Math.pow(2, attempt)));
    }
  }
}

export async function deleteMedia(id) {
  const { data } = await withRetry(() => client.delete(`/media/${id}`, { params: { force: true } }));
  return data;
}

export async function createPost(data) {
  const response = await withRetry(() => client.post('/posts', data), 3, 1000);
  return response.data;
}

export async function createPage(data) {
  const response = await withRetry(() => client.post('/pages', data), 3, 1000);
  return response.data;
}

// Fetch languages configured in Polylang.
// Tries the Polylang REST endpoint first; falls back to scanning translations fields.
export async function getPolylangLanguages() {
  // Attempt 1: Polylang REST API (available in Polylang ≥ 2.6)
  try {
    const { data } = await axios.get(`${BASE_URL}/wp-json/pll/v1/languages`, {
      httpsAgent: new https.Agent({ rejectUnauthorized: !INSECURE }),
      timeout: 10000,
      headers: { Authorization: getAuthHeader() },
    });
    if (Array.isArray(data) && data.length > 0) {
      return data.map((l) => ({
        code: l.code || l.slug || l.language_code,
        name: l.name,
        locale: l.locale || '',
      })).filter((l) => l.code);
    }
  } catch {}

  // Attempt 2: derive codes from the `translations` field of any post/page
  const LANG_NAMES = {
    de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano',
    nl: 'Nederlands', pl: 'Polski', pt: 'Português', ru: 'Русский', ja: '日本語',
    zh: '中文', ar: 'العربية', tr: 'Türkçe', sv: 'Svenska', da: 'Dansk',
    fi: 'Suomi', nb: 'Norsk', cs: 'Čeština', sk: 'Slovenčina', hu: 'Magyar',
    ro: 'Română', bg: 'Български', hr: 'Hrvatski', uk: 'Українська', ko: '한국어',
    el: 'Ελληνικά', he: 'עברית', th: 'ภาษาไทย', vi: 'Tiếng Việt',
  };
  try {
    const sample = await withRetry(
      () => client.get('/posts', { params: { per_page: 10, status: 'publish', _fields: 'lang,translations' } }),
      2, 500,
    );
    const codes = new Set();
    for (const item of sample.data) {
      if (item.lang) codes.add(item.lang);
      if (item.translations && typeof item.translations === 'object') {
        Object.keys(item.translations).forEach((k) => codes.add(k));
      }
    }
    if (codes.size > 0) {
      return [...codes].sort().map((code) => ({
        code,
        name: LANG_NAMES[code] || code.toUpperCase(),
        locale: '',
      }));
    }
  } catch {}

  return [];
}

export async function uploadMedia(buffer, mimeType, filename, meta = {}) {
  const doPost = () => client.post('/media', buffer, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  let uploadResponse;
  try {
    uploadResponse = await doPost();
  } catch (err) {
    if (!RETRYABLE.has(err.response?.status)) throw err;
    // 503 on upload: WordPress may have saved the file while generating thumbnails.
    // Wait and search by slug before retrying to prevent duplicate uploads.
    await new Promise(r => setTimeout(r, 5000));
    const slug = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      const search = await client.get('/media', { params: { search: slug, per_page: 5, orderby: 'date', order: 'desc' } });
      const match = search.data.find(m => m.slug === slug || m.slug.startsWith(slug));
      if (match) {
        if (Object.keys(meta).length > 0) {
          const u = await client.put(`/media/${match.id}`, meta);
          return u.data;
        }
        return match;
      }
    } catch {}
    // Not found in library — safe to retry once
    uploadResponse = await doPost();
  }

  const id = uploadResponse.data.id;
  if (Object.keys(meta).length > 0) {
    const updateResponse = await client.put(`/media/${id}`, meta);
    return updateResponse.data;
  }
  return uploadResponse.data;
}
