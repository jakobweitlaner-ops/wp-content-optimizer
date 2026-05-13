import axios from 'axios';
import pLimit from 'p-limit';
import { getPosts, getPages } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';

const TIMEOUT = parseInt(process.env.TIMEOUT || '10000', 10);

function extractLinks(html, sourceUrl) {
  const linkRegex = /href=["']([^"'#][^"']*)["']/gi;
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], sourceUrl).href;
      if (url.startsWith('http')) links.push(url);
    } catch {
      // skip malformed URLs
    }
  }
  return [...new Set(links)];
}

async function checkUrl(url) {
  try {
    const response = await axios.head(url, {
      timeout: TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (response.status === 405) {
      const get = await axios.get(url, {
        timeout: TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      return { url, status: get.status, ok: get.status < 400 };
    }
    return { url, status: response.status, ok: response.status < 400 };
  } catch (err) {
    return { url, status: null, ok: false, error: err.message };
  }
}

export async function checkLinks({ concurrency = 5, output } = {}) {
  log.header('Link Checker');
  log.info('Fetching posts and pages...');

  const [posts, pages] = await Promise.all([getPosts(), getPages()]);
  const content = [...posts, ...pages];

  log.info(`Checking links in ${content.length} posts/pages...`);

  const limit = pLimit(concurrency);
  const brokenLinks = [];
  const checked = new Map();

  for (const item of content) {
    const html = item.content?.rendered || '';
    const links = extractLinks(html, item.link);

    const results = await Promise.all(
      links.map((url) =>
        limit(async () => {
          if (checked.has(url)) return { url, ...checked.get(url) };
          const result = await checkUrl(url);
          checked.set(url, { status: result.status, ok: result.ok, error: result.error });
          return result;
        })
      )
    );

    const broken = results.filter((r) => !r.ok);
    if (broken.length > 0) {
      brokenLinks.push({
        post: { id: item.id, title: item.title?.rendered, url: item.link },
        broken,
      });
    }
  }

  if (brokenLinks.length === 0) {
    log.success('No broken links found.');
  } else {
    log.warn(`Found broken links in ${brokenLinks.length} post(s):`);
    for (const entry of brokenLinks) {
      log.row('Post:', entry.post.title || entry.post.url, 'yellow');
      for (const link of entry.broken) {
        const status = link.status ? `HTTP ${link.status}` : `Error: ${link.error}`;
        log.row('  Broken:', `${link.url} (${status})`, 'red');
      }
    }
  }

  if (output) saveReport(output, { summary: { totalChecked: checked.size, broken: brokenLinks.length }, brokenLinks });

  return brokenLinks;
}
