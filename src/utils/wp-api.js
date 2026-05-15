import axios from 'axios';
import https from 'https';

const BASE_URL = process.env.WP_URL;
const USERNAME = process.env.WP_USERNAME;
const APP_PASSWORD = process.env.WP_APP_PASSWORD;
const TIMEOUT = parseInt(process.env.TIMEOUT || '60000', 10);
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
    const response = await client.get(endpoint, {
      params: { ...params, per_page: 100, page },
    });
    results.push(...response.data);
    totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
    page++;
  } while (page <= totalPages);

  return results;
}

export async function getPosts(params = {}) {
  return fetchAllPages('/posts', { status: 'publish', ...params });
}

export async function getPages(params = {}) {
  return fetchAllPages('/pages', { status: 'publish', ...params });
}

export async function getMedia(params = {}) {
  return fetchAllPages('/media', params);
}

export async function getPost(id, params = {}) {
  const { data } = await client.get(`/posts/${id}`, { params });
  return data;
}

export async function getPage(id, params = {}) {
  const { data } = await client.get(`/pages/${id}`, { params });
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
