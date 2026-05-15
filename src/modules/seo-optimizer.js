import { getPosts, getPages, getPost, getPage, updatePost, updatePage, updateMedia, getMediaItem } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';
import { getSeoSuggestions, generateSeoFixes, generateH1Fix, generateContentExtension, generateKeyphrase, generateImageAltWithKeyphrase } from '../utils/claude-suggestions.js';

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function scoreYoast(post) {
  const yoast = post.yoast_head_json;
  const issues = [];
  let bonus = 0;

  if (!yoast) return { issues, bonus };

  const metaDesc = yoast.og_description || yoast.description || '';
  if (metaDesc && metaDesc.length >= 50 && metaDesc.length <= 140) {
    bonus += 10;
  } else if (!metaDesc) {
    issues.push('Yoast: Missing meta description');
  } else {
    issues.push(`Yoast: Meta description length ${metaDesc.length} chars (50–140 recommended)`);
  }

  const seoTitle = yoast.og_title || yoast.title || '';
  if (seoTitle && seoTitle.length >= 20 && seoTitle.length <= 60) {
    bonus += 5;
  } else if (seoTitle && seoTitle.length > 60) {
    issues.push(`Yoast: SEO title too long (${seoTitle.length} chars, max 60)`);
  }

  return { issues, bonus };
}

export function scoreSeo(post) {
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

  // Yoast/RankMath bonus & issues (up to +15)
  const { issues: yoastIssues, bonus } = scoreYoast(post);
  issues.push(...yoastIssues);
  score = Math.min(100, score + bonus);

  return { score: Math.max(0, score), issues, wordCount, h1Count: h1Matches.length, h2Count: h2Matches.length, _wordCount: wordCount };
}

export async function auditSeoItems() {
  const [posts, pages] = await Promise.all([getPosts(), getPages()]);
  const content = [
    ...posts.map((p) => ({ ...p, _type: 'post' })),
    ...pages.map((p) => ({ ...p, _type: 'page' })),
  ];
  return content.map((post) => {
    const seo = scoreSeo(post);
    const yoast = post.yoast_head_json || {};
    const h1Match = post.content?.rendered?.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const currentH1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
    return {
      id: post.id,
      type: post._type,
      title: post.title?.rendered || '(no title)',
      url: post.link,
      currentYoastTitle: yoast.og_title || yoast.title || '',
      currentYoastDesc: yoast.og_description || yoast.description || '',
      currentKeyphrase: post.meta?.['_yoast_wpseo_focuskw'] || '',
      currentH1,
      isNoindex: yoast.robots?.index === 'noindex' || post.meta?.['_yoast_wpseo_meta-robots-noindex'] == 1,
      ...seo,
    };
  }).sort((a, b) => a.score - b.score);
}

export async function generateSeoFixForItem(id, type, field) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const post = type === 'page' ? await getPage(id) : await getPost(id);
  const seo = scoreSeo(post);

  if (field === 'keyphrase') {
    return generateKeyphrase(post);
  }

  if (field === 'h1') {
    const h1Match = post.content?.rendered?.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const currentH1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
    return generateH1Fix({ ...post, currentH1 });
  }

  if (field === 'content') {
    return generateContentExtension({ ...post, _wordCount: seo.wordCount });
  }

  const issues = field === 'title'
    ? (seo.issues.filter((i) => /title/i.test(i)).length
        ? seo.issues.filter((i) => /title/i.test(i))
        : ['title needs improvement'])
    : (seo.issues.filter((i) => /excerpt|meta description/i.test(i)).length
        ? seo.issues.filter((i) => /excerpt|meta description/i.test(i))
        : ['meta description needs improvement']);
  const fixes = await generateSeoFixes(post, issues);
  return field === 'excerpt' ? (fixes.excerpt || null) : (fixes.title || null);
}

export async function auditSeo({ minScore = 80, aiSuggestions = false, output } = {}) {
  log.header('SEO Audit');

  if (aiSuggestions && !process.env.ANTHROPIC_API_KEY) {
    log.warn('ANTHROPIC_API_KEY not set — AI suggestions disabled.');
    aiSuggestions = false;
  }

  log.info('Fetching posts and pages...');
  const [posts, pages] = await Promise.all([getPosts(), getPages()]);
  const content = [
    ...posts.map((p) => ({ ...p, _type: 'post' })),
    ...pages.map((p) => ({ ...p, _type: 'page' })),
  ];
  log.info(`Analyzing ${content.length} posts/pages (${posts.length} posts, ${pages.length} pages)...`);

  const results = content.map((post, i) => {
    process.stdout.write(`\r  Analyzing ${i + 1}/${content.length}...`);
    const seo = scoreSeo(post);
    return {
      id: post.id,
      type: post._type,
      title: post.title?.rendered || '(no title)',
      url: post.link,
      ...seo,
    };
  });
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const belowThreshold = results.filter((r) => r.score < minScore);
  results.sort((a, b) => a.score - b.score);

  if (belowThreshold.length === 0) {
    log.success(`All posts/pages score above ${minScore}.`);
  } else {
    log.warn(`${belowThreshold.length} post(s)/page(s) below SEO score ${minScore}:`);
    for (const r of belowThreshold) {
      const color = r.score < 50 ? 'red' : 'yellow';
      log.row(r.title.substring(0, 36), `[${r.type}] Score: ${r.score}/100`, color);
      for (const issue of r.issues) {
        log.row('', `• ${issue}`, 'dim');
      }

      if (aiSuggestions && r.issues.length > 0) {
        try {
          const postObj = content.find((p) => p.id === r.id);
          const suggestions = await getSeoSuggestions({ ...postObj, _wordCount: r.wordCount }, r.issues);
          if (suggestions.length > 0) {
            log.row('', 'AI suggestions:', 'cyan');
            for (const s of suggestions) {
              log.row('', `  → ${s}`, 'cyan');
            }
          }
        } catch (err) {
          log.row('', `AI suggestions failed: ${err.message}`, 'dim');
        }
      }
    }
  }

  const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
  log.info(`Average SEO score: ${avg}/100`);
  if (aiSuggestions) log.info('AI suggestions powered by Claude.');

  if (output) saveReport(output, {
    summary: { total: results.length, posts: posts.length, pages: pages.length, belowThreshold: belowThreshold.length, averageScore: avg },
    results,
  });

  return results;
}

export async function getSeoImageProposals(id, type, keyphrase) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const post = type === 'page' ? await getPage(id) : await getPost(id);
  const title = post.title?.rendered || '';
  const content = post.content?.rendered || '';

  const idMatches = [...content.matchAll(/wp-image-(\d+)/g)];
  const imageIds = [...new Set(idMatches.map(m => parseInt(m[1], 10)))];
  if (imageIds.length === 0) return [];

  const mediaItems = (await Promise.all(
    imageIds.map(async imgId => {
      try {
        const media = await getMediaItem(imgId);
        return { id: imgId, currentAlt: media.alt_text || '', filename: media.source_url?.split('/').pop() || '' };
      } catch { return null; }
    })
  )).filter(Boolean);

  if (mediaItems.length === 0) return [];

  const suggestions = await generateImageAltWithKeyphrase(mediaItems, title, keyphrase);

  return mediaItems.map(item => {
    const suggestion = suggestions.find(s => s.id === item.id);
    return {
      imageId: item.id,
      filename: item.filename,
      currentAlt: item.currentAlt,
      proposedAlt: suggestion?.alt || '',
    };
  }).filter(p => p.proposedAlt);
}

const FIXABLE_ISSUE = /title too short|title too long|missing title|missing or empty excerpt/i;

export async function previewSeoFixes({ minScore = 80, onProgress, onError } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const [posts, pages] = await Promise.all([getPosts(), getPages()]);
  const content = [
    ...posts.map((p) => ({ ...p, _type: 'post' })),
    ...pages.map((p) => ({ ...p, _type: 'page' })),
  ];

  const candidates = content
    .map((post) => ({ post, seo: scoreSeo(post) }))
    .filter(({ seo }) => seo.score < minScore)
    .filter(({ seo }) => seo.issues.some((i) => FIXABLE_ISSUE.test(i)));

  const proposals = [];
  let done = 0;

  for (const { post, seo } of candidates) {
    const fixableIssues = seo.issues.filter((i) => FIXABLE_ISSUE.test(i));
    onProgress?.(++done, candidates.length, post.title?.rendered || '(no title)');

    try {
      const fixes = await generateSeoFixes(post, fixableIssues);

      if (fixes.title) {
        proposals.push({
          id: post.id,
          type: post._type,
          title: post.title?.rendered || '(no title)',
          url: post.link,
          field: 'title',
          issue: fixableIssues.find((i) => /title/i.test(i)) || '',
          currentValue: post.title?.rendered || '',
          proposedValue: fixes.title,
        });
      }

      if (fixes.excerpt) {
        proposals.push({
          id: post.id,
          type: post._type,
          title: post.title?.rendered || '(no title)',
          url: post.link,
          field: 'excerpt',
          issue: fixableIssues.find((i) => /excerpt|meta description/i.test(i)) || '',
          currentValue: post.excerpt?.rendered ? stripHtml(post.excerpt.rendered) : '',
          proposedValue: fixes.excerpt,
        });
      }

      if (!fixes.title && !fixes.excerpt) {
        onError?.(post.title?.rendered || '(no title)', `Kein Fix generiert (Issues: ${fixableIssues.join(', ')})`);
      }
    } catch (err) {
      onError?.(post.title?.rendered || '(no title)', err.message);
    }
  }

  return proposals;
}

const YOAST_FIELD_MAP = {
  title: '_yoast_wpseo_title',
  excerpt: '_yoast_wpseo_metadesc',
  keyphrase: '_yoast_wpseo_focuskw',
};

export async function applySeoFixes(changes) {
  const results = [];
  for (const { id, type, field, value } of changes) {
    try {
      if (type === 'media') {
        await updateMedia(parseInt(id, 10), { alt_text: value });
        results.push({ id, type, field, value, success: true });
        continue;
      }
      let data;
      if (field === 'h1' || field === 'content') {
        const post = type === 'page'
          ? await getPage(id, { context: 'edit' })
          : await getPost(id, { context: 'edit' });
        const rawContent = post.content?.raw || post.content?.rendered || '';
        const safeValue = value.replace(/<[^>]+>/g, '').trim();
        const isGutenberg = rawContent.includes('<!-- wp:');

        if (field === 'h1') {
          let newContent;
          if (/<h1[^>]*>/i.test(rawContent)) {
            const replacement = isGutenberg
              ? `<h1 class="wp-block-heading">${safeValue}</h1>`
              : `<h1>${safeValue}</h1>`;
            newContent = rawContent.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, replacement);
          } else {
            newContent = isGutenberg
              ? `<!-- wp:heading {"level":1} -->\n<h1 class="wp-block-heading">${safeValue}</h1>\n<!-- /wp:heading -->\n\n` + rawContent
              : `<h1>${safeValue}</h1>\n` + rawContent;
          }
          data = { content: newContent };
        } else {
          const paragraphs = safeValue.split(/\n\n+/).filter(Boolean);
          const addition = isGutenberg
            ? paragraphs.map(p => `<!-- wp:paragraph -->\n<p>${p.trim()}</p>\n<!-- /wp:paragraph -->`).join('\n\n')
            : paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n');
          data = { content: rawContent + '\n\n' + addition };
        }
      } else {
        const yoastKey = YOAST_FIELD_MAP[field];
        data = yoastKey ? { meta: { [yoastKey]: value } } : { [field]: value };
      }

      if (type === 'page') await updatePage(id, data);
      else await updatePost(id, data);
      results.push({ id, type, field, value, success: true });
    } catch (err) {
      results.push({ id, type, field, error: err.message, success: false });
    }
  }
  return results;
}
