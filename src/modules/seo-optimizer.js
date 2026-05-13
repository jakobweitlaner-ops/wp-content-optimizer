import { getPosts, updatePost } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';
import pLimit from 'p-limit';

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function scoreSeo(post) {
  const title = post.title?.rendered || '';
  const content = post.content?.rendered || '';
  const text = stripHtml(content);
  const issues = [];
  let score = 100;

  // Title checks (25 points)
  if (!title) {
    issues.push('Missing title');
    score -= 25;
  } else if (title.length < 20) {
    issues.push(`Title too short (${title.length} chars, min 20)`);
    score -= 10;
  } else if (title.length > 60) {
    issues.push(`Title too long (${title.length} chars, max 60)`);
    score -= 5;
  }

  // H1 check (20 points)
  const h1Matches = content.match(/<h1[^>]*>/gi) || [];
  if (h1Matches.length === 0) {
    issues.push('No H1 heading found');
    score -= 20;
  } else if (h1Matches.length > 1) {
    issues.push(`Multiple H1 headings (${h1Matches.length})`);
    score -= 10;
  }

  // Word count (25 points)
  const wordCount = countWords(text);
  if (wordCount < 300) {
    issues.push(`Content too short (${wordCount} words, min 300)`);
    score -= 25;
  } else if (wordCount < 600) {
    issues.push(`Content could be longer (${wordCount} words, recommended 600+)`);
    score -= 10;
  }

  // H2 structure (15 points)
  const h2Matches = content.match(/<h2[^>]*>/gi) || [];
  if (wordCount > 600 && h2Matches.length === 0) {
    issues.push('No H2 subheadings for long content');
    score -= 15;
  }

  // Excerpt/meta description (15 points)
  const excerpt = post.excerpt?.rendered || '';
  if (!excerpt || stripHtml(excerpt).length < 10) {
    issues.push('Missing or empty excerpt/meta description');
    score -= 15;
  }

  return { score: Math.max(0, score), issues, wordCount, h1Count: h1Matches.length, h2Count: h2Matches.length };
}

export async function auditSeo({ minScore = 80, output, fix = false } = {}) {
  log.header('SEO Audit');
  log.info('Fetching posts...');

  const posts = await getPosts();
  log.info(`Analyzing ${posts.length} posts...`);

  const postMap = new Map(posts.map((p) => [p.id, p]));

  const results = posts.map((post) => {
    const seo = scoreSeo(post);
    return {
      id: post.id,
      title: post.title?.rendered || '(no title)',
      url: post.link,
      ...seo,
    };
  });

  const belowThreshold = results.filter((r) => r.score < minScore);
  results.sort((a, b) => a.score - b.score);

  if (belowThreshold.length === 0) {
    log.success(`All posts score above ${minScore}.`);
  } else {
    log.warn(`${belowThreshold.length} post(s) below SEO score ${minScore}:`);
    for (const r of belowThreshold) {
      const color = r.score < 50 ? 'red' : 'yellow';
      log.row(r.title.substring(0, 40), `Score: ${r.score}/100`, color);
      for (const issue of r.issues) {
        log.row('', `• ${issue}`, 'dim');
      }
    }
  }

  const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  log.info(`Average SEO score: ${avg}/100`);

  if (fix && belowThreshold.length > 0) {
    const { generateSeoFixes } = await import('../utils/claude.js');
    const fixable = belowThreshold.filter((r) => r.issues.some((i) => /title|excerpt/i.test(i)));

    if (fixable.length === 0) {
      log.info('No AI-fixable issues found (only title/excerpt are auto-fixable).');
    } else {
      log.info(`\nGenerating AI fixes for ${fixable.length} post(s)...`);
      const limit = pLimit(3);
      let fixed = 0;

      await Promise.all(
        fixable.map((r) =>
          limit(async () => {
            try {
              const suggestions = await generateSeoFixes(postMap.get(r.id), r.issues);
              if (!suggestions) return;

              const update = {};
              if (suggestions.title) update.title = suggestions.title;
              if (suggestions.excerpt) update.excerpt = suggestions.excerpt;
              if (Object.keys(update).length === 0) return;

              await updatePost(r.id, update);
              fixed++;
              log.row(r.title.substring(0, 35), `Fixed: ${Object.keys(update).join(', ')}`, 'green');
            } catch (err) {
              log.row(r.title.substring(0, 35), `Error: ${err.message}`, 'red');
            }
          })
        )
      );

      log.success(`Fixed ${fixed}/${fixable.length} posts.`);
    }
  }

  if (output) saveReport(output, { summary: { total: results.length, belowThreshold: belowThreshold.length, averageScore: avg }, results });

  return results;
}
