import axios from 'axios';
import https from 'https';

const BASE_URL = process.env.WP_URL;
const USERNAME = process.env.WP_USERNAME;
const APP_PASSWORD = process.env.WP_APP_PASSWORD;
const TIMEOUT = parseInt(process.env.TIMEOUT || '10000', 10);
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

export async function updatePost(id, data) {
  const response = await client.put(`/posts/${id}`, data);
  return response.data;
}

export async function updateMedia(id, data) {
  const response = await client.put(`/media/${id}`, data);
  return response.data;
}
