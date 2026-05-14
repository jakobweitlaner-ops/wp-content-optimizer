import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSeoFixes(post, issues) {
  const title = post.title?.rendered || '(no title)';
  const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const contentSnippet = content.substring(0, 600);

  const needsTitle = issues.some((i) => /title/i.test(i));
  const needsExcerpt = issues.some((i) => /excerpt|meta description/i.test(i));

  const fixRequests = [];
  if (needsTitle) fixRequests.push('"title": "<optimized title, 20–60 chars>"');
  if (needsExcerpt) fixRequests.push('"excerpt": "<meta description, 120–160 chars>"');

  if (fixRequests.length === 0) return {};

  const prompt = `You are an SEO expert. Generate improved field values for this WordPress post.

Title: ${title}
Current excerpt: ${excerpt || '(none)'}
Content preview: ${contentSnippet}
Issues to fix: ${issues.join(', ')}

Return ONLY a JSON object with these fields (include only fields that need fixing):
{ ${fixRequests.join(', ')} }

Requirements:
- title: 20–60 characters, descriptive, includes main topic, no keyword stuffing
- excerpt: 120–160 characters, compelling meta description summarizing the content`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are an SEO assistant. Always respond with valid JSON only.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.text?.trim() || '{}';
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function getSeoSuggestions(post, issues) {
  const title = post.title?.rendered || '(no title)';
  const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';
  const wordCount = post._wordCount || 0;

  const prompt = `You are an SEO expert. Analyze this WordPress post and give 2-3 concrete, actionable improvement suggestions.

Title: ${title}
Excerpt: ${excerpt || '(none)'}
Word count: ${wordCount}
SEO issues found: ${issues.join(', ')}

Respond with a JSON array of short suggestion strings (max 15 words each). Example:
["Add a focus keyword to the title", "Expand content to at least 600 words"]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: 'You are an SEO assistant. Always respond with valid JSON only.',
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.text?.trim() || '[]';
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
