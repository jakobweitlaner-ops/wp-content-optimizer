import axios from 'axios';
import pLimit from 'p-limit';
import { getPosts, getPages } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';

const LINK_TIMEOUT = parseInt(process.env.LINK_TIMEOUT || '20000', 10);

function extractLinks(html, sourceUrl, baseUrl) {
  const linkRegex = /href=["']([^"'#][^"']*)["']/gi;
  const links = [];
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], sourceUrl).href;
      if (url.startsWith('http') && !url.includes(baseUrl)) links.push(url);
    } catch {
      // skip malformed URLs
    }
  }
  return [...new Set(links)];
}

async function checkUrl(url) {
  try {
    const response = await axios.head(url, {
      timeout: LINK_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (response.status === 405) {
      const get = await axios.get(url, {
        timeout: LINK_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      return { url, status: get.status, ok: get.status < 400 };
    }
    return { url, status: response.status, ok: response.status < 400 };
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
    return { url, status: null, ok: false, error: err.message, timeout: isTimeout };
  }
}

export async function checkLinks({ concurrency = 5, output } = {}) {
  log.header('Link Checker');
  log.info(`Fetching posts and pages (timeout: ${LINK_TIMEOUT}ms)...`);

  const [posts, pages] = await Promise.all([getPosts(), getPages()]);
  const content = [...posts, ...pages];

  log.info(`Checking external links in ${content.length} posts/pages...`);

  const limit = pLimit(concurrency);
  const brokenLinks = [];
  const timeoutLinks = [];
  const checked = new Map();

  for (const item of content) {
    const html = item.content?.rendered || '';
    const baseUrl = new URL(item.link).hostname;
    const links = extractLinks(html, item.link, baseUrl);

    if (links.length === 0) continue;

    const results = await Promise.all(
      links.map((url) =>
        limit(async () => {
          if (checked.has(url)) return { url, ...checked.get(url) };
          const result = await checkUrl(url);
          checked.set(url, { status: result.status, ok: result.ok, error: result.error, timeout: result.timeout });
          return result;
        })
      )
    );

    const broken = results.filter((r) => !r.ok && !r.timeout);
    const timeouts = results.filter((r) => r.timeout);

    if (broken.length > 0) {
      brokenLinks.push({
        post: { id: item.id, title: item.title?.rendered, url: item.link },
        broken,
      });
    }

    if (timeouts.length > 0) {
      timeoutLinks.push({
        post: { id: item.id, title: item.title?.rendered, url: item.link },
        timeouts,
      });
    }
  }

  if (brokenLinks.length === 0 && timeoutLinks.length === 0) {
    log.success('All external links OK.');
  } else {
    if (brokenLinks.length > 0) {
      log.warn(`Found broken links in ${brokenLinks.length} post(s):`);
      for (const entry of brokenLinks) {
        log.row('Post:', entry.post.title || entry.post.url, 'yellow');
        for (const link of entry.broken) {
          const status = link.status ? `HTTP ${link.status}` : `Error: ${link.error}`;
          log.row('  Broken:', `${link.url} (${status})`, 'red');
        }
      }
    }

    if (timeoutLinks.length > 0) {
      log.warn(`Found timeout links in ${timeoutLinks.length} post(s):`);
      for (const entry of timeoutLinks) {
        log.row('Post:', entry.post.title || entry.post.url, 'yellow');
        for (const link of entry.timeouts) {
          log.row('  Timeout:', link.url, 'dim');
        }
      }
    }
  }

  log.info(`Checked ${checked.size} unique external links.`);

  if (output) {
    saveReport(output, {
      summary: { totalChecked: checked.size, broken: brokenLinks.length, timeouts: timeoutLinks.length },
      brokenLinks,
      timeoutLinks,
    });
  }

  return { brokenLinks, timeoutLinks };
}
