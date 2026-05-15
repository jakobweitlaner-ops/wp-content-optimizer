import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSeoFixes(post, issues) {
  const title = post.title?.rendered || '(no title)';
  const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const contentSnippet = content.substring(0, 400);

  const needsTitle = issues.some((i) => /title/i.test(i));
  const needsExcerpt = issues.some((i) => /excerpt|meta description/i.test(i));

  if (!needsTitle && !needsExcerpt) return {};

  let prompt;
  if (needsTitle && needsExcerpt) {
    prompt = `You are an SEO expert. Create an improved title and meta description for this WordPress page.

Current title: "${title}"
Content: ${contentSnippet}
Issues: ${issues.join('; ')}

Rules:
- title: 20-60 characters, descriptive, same language as content
- excerpt: 120-160 characters, compelling summary, same language as content

Respond with ONLY this JSON (no explanation, no markdown):
{"title": "your improved title", "excerpt": "your meta description"}`;
  } else if (needsTitle) {
    prompt = `You are an SEO expert. Create an improved SEO title for this WordPress page.

Current title: "${title}"
Content: ${contentSnippet}
Issue: ${issues.join('; ')}

Rules:
- Must be 20-60 characters
- Descriptive and specific to the page content
- Same language as the content

Respond with ONLY this JSON (no explanation, no markdown):
{"title": "your improved title"}`;
  } else {
    prompt = `You are an SEO expert. Create a meta description for this WordPress page.

Title: "${title}"
Content: ${contentSnippet}
Issue: ${issues.join('; ')}

Rules:
- Must be 120-160 characters
- Compelling summary of the page
- Same language as the content

Respond with ONLY this JSON (no explanation, no markdown):
{"excerpt": "your meta description"}`;
  }

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are an SEO assistant. Always respond with valid JSON only. Never add explanation or markdown formatting.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export async function generateH1Fix(post) {
  const title = post.title?.rendered || '(no title)';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const currentH1 = post.currentH1 || '';

  const prompt = `You are an SEO expert. Create an optimized H1 heading for this WordPress page.

Title: "${title}"
${currentH1 ? `Current H1: "${currentH1}"` : 'Current H1: (none)'}
Content snippet: ${content.substring(0, 600)}

Rules:
- Descriptive and contains the main keyword
- Should differ from the SEO title when possible (can be more natural/longer)
- Same language as the content
- Plain text only, no HTML tags

Respond with ONLY this JSON (no explanation, no markdown):
{"h1": "your optimized H1 heading"}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: 'You are an SEO assistant. Always respond with valid JSON only. Never add explanation or markdown formatting.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.h1 || null;
  } catch {
    return null;
  }
}

export async function generateContentExtension(post) {
  const title = post.title?.rendered || '(no title)';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const wordCount = post._wordCount || 0;

  const prompt = `You are a content writer. Write 1-2 additional paragraphs to extend this WordPress post that is currently too short.

Post title: "${title}"
Current content (${wordCount} words): ${content.substring(0, 800)}

Rules:
- Same language and tone as the existing content
- Add useful, relevant information that complements the existing text
- Each paragraph 60-100 words
- Separate paragraphs with a blank line
- Plain text only, no HTML tags

Respond with ONLY this JSON (no explanation, no markdown):
{"content": "your additional paragraph(s) here"}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are a content writer. Always respond with valid JSON only. Never add explanation or markdown formatting.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.content || null;
  } catch {
    return null;
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
