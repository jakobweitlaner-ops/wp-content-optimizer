import { getPosts, getPages, getPost, getPage, updatePost, updatePage, updateMedia, getMediaItem } from '../utils/wp-api.js';
import { log, saveReport } from '../utils/logger.js';
import { getSeoSuggestions, generateSeoFixes, generateH1Fix, generateContentExtension, generateKeyphrase, generateImageAltWithKeyphrase, generateIntroFix } from '../utils/claude-suggestions.js';

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function detectHeadingFormat(content) {
  const match = content.match(/<(h[123])([^>]*)>([\s\S]*?)<\/h[123]>/i);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  const attrs = match[2];
  const classMatch = attrs.match(/class="([^"]*)"/i);
  const styleMatch = attrs.match(/style="([^"]*)"/i);
  return {
    tag,
    classes: classMatch ? classMatch[1].trim() : '',
    style: styleMatch ? styleMatch[1].trim() : '',
    text: match[3].replace(/<[^>]+>/g, '').trim(),
    isH1: tag === 'h1',
    needsConversion: tag !== 'h1',
  };
}

function scoreYoast(post) {
  const yoast = post.yoast_head_json;
  const issues = [];
  let bonus = 0;

  if (!yoast) return { issues, bonus };

  const metaDesc = yoast.og_description || yoast.description || '';
  if (metaDesc && metaDesc.length >= 50 && metaDesc.length <= 120) {
    bonus += 10;
  } else if (!metaDesc) {
    issues.push('Yoast: Missing meta description');
  } else {
    issues.push(`Yoast: Meta description length ${metaDesc.length} chars (50–120 recommended)`);
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
  // Use Yoast SEO title for length checks when available — that's what search engines see
  const yoastRenderedTitle = post.yoast_head_json?.og_title || post.yoast_head_json?.title || '';
  const effectiveTitle = yoastRenderedTitle || title;
  if (!title) {
    issues.push('Missing title');
    score -= 25;
  } else if (effectiveTitle.length < 20) {
    issues.push(`Title too short (${effectiveTitle.length} chars, min 20)`);
    score -= 10;
  } else if (effectiveTitle.length > 60) {
    issues.push(`Title too long (${effectiveTitle.length} chars, max 60)`);
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

  // Keyphrase checks (only when keyphrase is set)
  const keyphrase = post.meta?.['_yoast_wpseo_focuskw'] || '';
  if (keyphrase) {
    const kpWords = keyphrase.toLowerCase().split(/\s+/).filter(Boolean);
    const yoastTitle = (post.yoast_head_json?.og_title || post.yoast_head_json?.title || '').toLowerCase();
    const metaDescText = (post.yoast_head_json?.og_description || post.yoast_head_json?.description || '').toLowerCase();
    const contentLower = text.toLowerCase();

    // Keyphrase in SEO title
    if (yoastTitle && !kpWords.every(w => yoastTitle.includes(w))) {
      issues.push('Keyphrase not in SEO title');
      score -= 10;
    }

    // Keyphrase in meta description
    if (metaDescText && !kpWords.some(w => metaDescText.includes(w))) {
      issues.push('Keyphrase not in meta description');
      score -= 10;
    }

    // Keyphrase in first paragraph
    const firstParaMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const firstParaText = firstParaMatch ? firstParaMatch[1].replace(/<[^>]+>/g, '').toLowerCase() : '';
    if (!firstParaText || !kpWords.some(w => firstParaText.includes(w))) {
      issues.push('Keyphrase not in first paragraph');
      score -= 10;
    }

    // Keyphrase density
    const escaped = keyphrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const kpCount = (contentLower.match(new RegExp(escaped, 'gi')) || []).length;
    if (kpCount < 2) {
      issues.push(`Keyphrase density too low (${kpCount}×, min 2)`);
      score -= 5;
    }

    // Keyphrase in subheadings
    const h2h3Text = (content.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi) || [])
      .join(' ').replace(/<[^>]+>/g, '').toLowerCase();
    if (wordCount > 300 && h2h3Text && !kpWords.some(w => h2h3Text.includes(w))) {
      issues.push('Keyphrase not in subheadings');
      score -= 5;
    }
  }

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
    const renderedContent = post.content?.rendered || '';
    const h1Match = renderedContent.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const currentH1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : '';
    const firstParaMatch2 = renderedContent.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const currentIntro = firstParaMatch2 ? firstParaMatch2[1].replace(/<[^>]+>/g, '').trim().substring(0, 150) : '';
    const headingFormat = detectHeadingFormat(renderedContent);
    return {
      id: post.id,
      type: post._type,
      title: post.title?.rendered || '(no title)',
      url: post.link,
      currentYoastTitle: yoast.og_title || yoast.title || '',
      currentYoastDesc: yoast.og_description || yoast.description || '',
      currentKeyphrase: post.meta?.['_yoast_wpseo_focuskw'] || '',
      currentH1,
      currentIntro,
      headingFormat,
      isNoindex: yoast.robots?.index === 'noindex' || post.meta?.['_yoast_wpseo_meta-robots-noindex'] == 1,
      ...seo,
    };
  }).filter(item => !item.isNoindex).sort((a, b) => a.score - b.score);
}

export async function generateSeoFixForItem(id, type, field) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const post = type === 'page' ? await getPage(id) : await getPost(id);
  const seo = scoreSeo(post);

  if (field === 'keyphrase') {
    return generateKeyphrase(post);
  }

  if (field === 'intro') {
    const kp = post.meta?.['_yoast_wpseo_focuskw'] || '';
    const firstParaMatch = post.content?.rendered?.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const currentIntro = firstParaMatch ? firstParaMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    return generateIntroFix({ ...post, currentIntro }, kp);
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
  const kp = post.meta?.['_yoast_wpseo_focuskw'] || '';
  const fixes = await generateSeoFixes(post, issues, kp);
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
      if (field === 'h1' || field === 'content' || field === 'intro') {
        const post = type === 'page'
          ? await getPage(id, { context: 'edit' })
          : await getPost(id, { context: 'edit' });
        const rawContent = post.content?.raw || post.content?.rendered || '';
        const safeValue = value.replace(/<[^>]+>/g, '').trim();
        const isGutenberg = rawContent.includes('<!-- wp:');

        if (field === 'h1') {
          const headingFormat = detectHeadingFormat(rawContent);
          const existingClasses = headingFormat?.classes || (isGutenberg ? 'wp-block-heading' : '');
          const classAttr = existingClasses ? ` class="${existingClasses}"` : '';
          const newH1Tag = `<h1${classAttr}>${safeValue}</h1>`;
          const newBlock = `<!-- wp:heading {"level":1} -->\n${newH1Tag}\n<!-- /wp:heading -->`;

          let newContent;
          if (headingFormat?.needsConversion) {
            const srcTag = headingFormat.tag;   // 'h2' or 'h3'
            const srcLevel = srcTag.slice(1);   // '2' or '3'
            const gutenbergStandardRe = new RegExp(
              `<!-- wp:heading[^\\n]*-->\\n?<${srcTag}[^>]*>[\\s\\S]*?<\\/${srcTag}>\\n?<!-- \\/wp:heading -->`, 'i'
            );
            if (isGutenberg && gutenbergStandardRe.test(rawContent)) {
              // Standard wp:heading block → replace whole block with level:1
              newContent = rawContent.replace(gutenbergStandardRe, newBlock);
            } else if (isGutenberg) {
              // Custom block (UAGB etc.): attribute updates are unreliable because
              // Gutenberg validates by running the block's save() function — any
              // mismatch reverts on editor open. Instead, replace the entire custom
              // block with a standard wp:heading block (keeps CSS classes).
              const headingPos = rawContent.search(new RegExp(`<${srcTag}[\\s>]`, 'i'));
              if (headingPos !== -1) {
                const blockOpenPos = rawContent.lastIndexOf('<!-- wp:', headingPos);
                const headingClosePos = rawContent.indexOf(`</${srcTag}>`, headingPos) + `</${srcTag}>`.length;
                const afterClose = rawContent.slice(headingClosePos);
                const blockCloseMatch = afterClose.match(/<!-- \/wp:[^\n]+-->/i);
                if (blockOpenPos !== -1 && blockCloseMatch) {
                  const blockCloseEnd = headingClosePos + afterClose.indexOf(blockCloseMatch[0]) + blockCloseMatch[0].length;
                  newContent = rawContent.slice(0, blockOpenPos) + newBlock + rawContent.slice(blockCloseEnd);
                } else {
                  newContent = rawContent.replace(new RegExp(`<${srcTag}[^>]*>[\\s\\S]*?<\\/${srcTag}>`, 'i'), newH1Tag);
                }
              } else {
                newContent = rawContent.replace(new RegExp(`<${srcTag}[^>]*>[\\s\\S]*?<\\/${srcTag}>`, 'i'), newH1Tag);
              }
            } else {
              newContent = rawContent.replace(
                new RegExp(`<${srcTag}[^>]*>[\\s\\S]*?<\\/${srcTag}>`, 'i'),
                newH1Tag
              );
            }
          } else if (/<h1[^>]*>/i.test(rawContent)) {
            // Update existing H1 text while keeping its classes and block structure
            const gutenbergStandardRe = /<!-- wp:heading[^>]*-->\n?<h1[^>]*>[\s\S]*?<\/h1>\n?<!-- \/wp:heading -->/i;
            if (isGutenberg && gutenbergStandardRe.test(rawContent)) {
              newContent = rawContent.replace(gutenbergStandardRe, newBlock);
            } else {
              newContent = rawContent.replace(/<h1([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1>${safeValue}</h1>`);
            }
          } else {
            throw new Error('Keine Überschrift (H1/H2/H3) im Content gefunden – H1 bitte manuell im WP-Editor an der gewünschten Position einfügen');
          }
          data = { content: newContent };
        } else if (field === 'intro') {
          const newParagraph = isGutenberg
            ? `<!-- wp:paragraph -->\n<p>${safeValue}</p>\n<!-- /wp:paragraph -->`
            : `<p>${safeValue}</p>`;
          let newContent;
          if (isGutenberg) {
            // Find the closing comment of whatever block contains </h1> (wp:heading, uagb, etc.)
            // by matching </h1> then lazily up to the next --> block-comment close.
            const h1ThenParaRe = /(<\/h1>[\s\S]*?-->)(\n+)(<!-- wp:paragraph -->[\s\S]*?<!-- \/wp:paragraph -->)/i;
            const h1BlockCloseRe = /(<\/h1>[\s\S]*?-->)/i;
            if (h1ThenParaRe.test(rawContent)) {
              // Paragraph immediately follows H1 block — replace it
              newContent = rawContent.replace(h1ThenParaRe, `$1$2${newParagraph}`);
            } else if (h1BlockCloseRe.test(rawContent)) {
              // Insert directly after the H1 block's closing comment
              newContent = rawContent.replace(h1BlockCloseRe, `$1\n\n${newParagraph}`);
            } else {
              newContent = newParagraph + '\n\n' + rawContent;
            }
          } else {
            // Classic: insert/replace paragraph right after </h1>
            const h1ImmediateParaRe = /(<\/h1>)(\s*)(<p[^>]*>[\s\S]*?<\/p>)/i;
            if (h1ImmediateParaRe.test(rawContent)) {
              newContent = rawContent.replace(h1ImmediateParaRe, `$1$2${newParagraph}`);
            } else if (/<\/h1>/i.test(rawContent)) {
              newContent = rawContent.replace(/<\/h1>/i, `</h1>\n${newParagraph}`);
            } else if (/<p[^>]*>/.test(rawContent)) {
              newContent = rawContent.replace(/<p[^>]*>[\s\S]*?<\/p>/, newParagraph);
            } else {
              newContent = newParagraph + '\n' + rawContent;
            }
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
