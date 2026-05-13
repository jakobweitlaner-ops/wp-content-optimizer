import { describe, it, expect } from 'vitest';

// Pure functions copied from seo-optimizer.js for isolated testing
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
  if (metaDesc && metaDesc.length >= 50 && metaDesc.length <= 160) {
    bonus += 10;
  } else if (!metaDesc) {
    issues.push('Yoast: Missing meta description');
  } else {
    issues.push(`Yoast: Meta description length ${metaDesc.length} chars (50–160 recommended)`);
  }

  const seoTitle = yoast.og_title || yoast.title || '';
  if (seoTitle && seoTitle.length >= 20 && seoTitle.length <= 60) {
    bonus += 5;
  } else if (seoTitle && seoTitle.length > 60) {
    issues.push(`Yoast: SEO title too long (${seoTitle.length} chars, max 60)`);
  }

  return { issues, bonus };
}

function scoreSeo(post) {
  const title = post.title?.rendered || '';
  const content = post.content?.rendered || '';
  const text = stripHtml(content);
  const issues = [];
  let score = 100;

  if (!title) { issues.push('Missing title'); score -= 25; }
  else if (title.length < 20) { issues.push(`Title too short (${title.length} chars, min 20)`); score -= 10; }
  else if (title.length > 60) { issues.push(`Title too long (${title.length} chars, max 60)`); score -= 5; }

  const h1Matches = content.match(/<h1[^>]*>/gi) || [];
  if (h1Matches.length === 0) { issues.push('No H1 heading found'); score -= 20; }
  else if (h1Matches.length > 1) { issues.push(`Multiple H1 headings (${h1Matches.length})`); score -= 10; }

  const wordCount = countWords(text);
  if (wordCount < 300) { issues.push(`Content too short (${wordCount} words, min 300)`); score -= 25; }
  else if (wordCount < 600) { issues.push(`Content could be longer (${wordCount} words, recommended 600+)`); score -= 10; }

  const h2Matches = content.match(/<h2[^>]*>/gi) || [];
  if (wordCount > 600 && h2Matches.length === 0) { issues.push('No H2 subheadings for long content'); score -= 15; }

  const excerpt = post.excerpt?.rendered || '';
  if (!excerpt || stripHtml(excerpt).length < 10) { issues.push('Missing or empty excerpt/meta description'); score -= 15; }

  const { issues: yoastIssues, bonus } = scoreYoast(post);
  issues.push(...yoastIssues);
  score = Math.min(100, score + bonus);

  return { score: Math.max(0, score), issues, wordCount, h1Count: h1Matches.length, h2Count: h2Matches.length };
}

// 598 content words + "<h1>H</h1><h2>Sub</h2>" => after stripHtml: "H Sub word..." = 600 words exactly
// 600 > 600 is false → no H2 penalty; presence of <h2> also satisfies H2 check for >600 word posts
const LONG_CONTENT = `<h1>Heading</h1><h2>Subheading</h2>${Array(598).fill('word').join(' ')}`;

// 298 content words + H1 → 299 words < 300
const SHORT_CONTENT = `<h1>Heading</h1>${Array(298).fill('word').join(' ')}`;

// 398 content words + H1 → 399 words (>=300, <600)
const MEDIUM_CONTENT = `<h1>Heading</h1>${Array(398).fill('word').join(' ')}`;

const GOOD_TITLE = 'A Title That Is Long Enough For SEO';
const GOOD_EXCERPT = { rendered: 'This is a good excerpt with enough text here to satisfy the minimum.' };

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>World</b></p>')).toBe('Hello World');
  });
  it('collapses whitespace', () => {
    expect(stripHtml('<p>  a  </p>  <p>  b  </p>')).toBe('a b');
  });
});

describe('countWords', () => {
  it('counts words correctly', () => {
    expect(countWords('one two three')).toBe(3);
  });
  it('ignores extra whitespace', () => {
    expect(countWords('  one   two  ')).toBe(2);
  });
});

describe('scoreSeo', () => {
  it('gives full score for a perfect post', () => {
    const { score, issues } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: LONG_CONTENT },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(100);
    expect(issues).toHaveLength(0);
  });

  it('penalizes missing title (-25)', () => {
    const { score } = scoreSeo({
      title: { rendered: '' },
      content: { rendered: LONG_CONTENT },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(75);
  });

  it('penalizes short title (-10)', () => {
    const { score } = scoreSeo({
      title: { rendered: 'Short' },
      content: { rendered: LONG_CONTENT },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(90);
  });

  it('penalizes long title (-5)', () => {
    const { score } = scoreSeo({
      title: { rendered: 'A'.repeat(61) },
      content: { rendered: LONG_CONTENT },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(95);
  });

  it('penalizes missing H1 (-20)', () => {
    const { score } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: Array(600).fill('word').join(' ') },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(80);
  });

  it('penalizes multiple H1s (-10)', () => {
    const { score, issues } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: `<h1>A</h1><h1>B</h1><h2>Sub</h2>${Array(598).fill('word').join(' ')}` },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(90);
    expect(issues).toContain('Multiple H1 headings (2)');
  });

  it('penalizes content < 300 words (-25)', () => {
    const { score } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: SHORT_CONTENT },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(75); // 100 - 25 (short content); H1 present, excerpt OK
  });

  it('penalizes content between 300-600 words (-10)', () => {
    const { score } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: MEDIUM_CONTENT },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(90);
  });

  it('penalizes missing H2 for long content (-15)', () => {
    // 600+ words but no H2
    const { score } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: `<h1>H</h1>${Array(600).fill('word').join(' ')}` },
      excerpt: GOOD_EXCERPT,
    });
    expect(score).toBe(85);
  });

  it('penalizes missing excerpt (-15)', () => {
    const { score } = scoreSeo({
      title: { rendered: GOOD_TITLE },
      content: { rendered: LONG_CONTENT },
      excerpt: { rendered: '' },
    });
    expect(score).toBe(85);
  });

  it('score never goes below 0', () => {
    const { score } = scoreSeo({
      title: { rendered: '' },
      content: { rendered: 'tiny' },
      excerpt: { rendered: '' },
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe('scoreYoast', () => {
  it('returns no bonus without yoast data', () => {
    const { bonus, issues } = scoreYoast({});
    expect(bonus).toBe(0);
    expect(issues).toHaveLength(0);
  });

  it('gives +10 for good meta description', () => {
    const { bonus } = scoreYoast({
      yoast_head_json: { og_description: 'A good meta description that is between fifty and one hundred sixty characters long enough.' },
    });
    expect(bonus).toBe(10);
  });

  it('reports missing meta description as issue', () => {
    const { issues } = scoreYoast({ yoast_head_json: {} });
    expect(issues).toContain('Yoast: Missing meta description');
  });

  it('gives +15 for good meta description and good SEO title', () => {
    const { bonus } = scoreYoast({
      yoast_head_json: {
        og_description: 'A good meta description that is between fifty and one hundred sixty characters long enough.',
        og_title: 'A Good SEO Title Of Right Length Here',
      },
    });
    expect(bonus).toBe(15);
  });

  it('flags an overly long SEO title', () => {
    const { issues } = scoreYoast({
      yoast_head_json: {
        og_description: 'A good meta description that is between fifty and one hundred sixty characters long enough.',
        og_title: 'A'.repeat(65),
      },
    });
    expect(issues.some((i) => i.includes('SEO title too long'))).toBe(true);
  });
});
