import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSeoFixes(post, issues) {
  const title = post.title?.rendered || '(no title)';
  const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const contentSnippet = content.substring(0, 600);

  const needsTitle = issues.some((i) => /title/i.test(i));
  const needsExcerpt = issues.some((i) => /excerpt|meta description/i.test(i));

  if (!needsTitle && !needsExcerpt) return {};

  const fieldsNeeded = [needsTitle && 'title', needsExcerpt && 'excerpt'].filter(Boolean).join(' and ');

  const prompt = `You are an SEO expert. Fix the following WordPress post by generating improved values for: ${fieldsNeeded}.

Post title: ${title}
Current excerpt: ${excerpt || '(none)'}
Content preview: ${contentSnippet}
SEO issues: ${issues.join(', ')}

Respond with ONLY a valid JSON object. Do not include any explanation or markdown.${needsTitle ? `
"title" must be 20–60 characters, descriptive, include the main topic.` : ''}${needsExcerpt ? `
"excerpt" must be 120–160 characters, a compelling meta description.` : ''}

Example response format: {"title": "Your improved title here", "excerpt": "Your improved excerpt here"}

Only include keys for the fields listed above (${fieldsNeeded}).`;

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
