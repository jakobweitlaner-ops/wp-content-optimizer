import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSeoFixes(post, issues, keyphrase = '') {
  const title = post.title?.rendered || '(no title)';
  const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const contentSnippet = content.substring(0, 400);
  const keyphraseHint = keyphrase ? `\nFocus keyphrase: "${keyphrase}" — must appear naturally in the generated text.` : '';

  const needsTitle = issues.some((i) => /title/i.test(i));
  const needsExcerpt = issues.some((i) => /excerpt|meta description/i.test(i));

  if (!needsTitle && !needsExcerpt) return {};

  let prompt;
  if (needsTitle && needsExcerpt) {
    prompt = `You are an SEO expert. Create an improved title and meta description for this WordPress page.

Current title: "${title}"
Content: ${contentSnippet}
Issues: ${issues.join('; ')}${keyphraseHint}

Rules:
- title: 20-60 characters, descriptive, same language as content
- excerpt: 100-120 characters, compelling summary, same language as content

Respond with ONLY this JSON (no explanation, no markdown):
{"title": "your improved title", "excerpt": "your meta description"}`;
  } else if (needsTitle) {
    prompt = `You are an SEO expert. Create an improved SEO title for this WordPress page.

Current title: "${title}"
Content: ${contentSnippet}
Issue: ${issues.join('; ')}${keyphraseHint}

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
Issue: ${issues.join('; ')}${keyphraseHint}

Rules:
- Must be 100-120 characters
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
    if (typeof parsed !== 'object' || parsed === null) return {};
    if (parsed.excerpt && parsed.excerpt.length > 120) {
      parsed.excerpt = parsed.excerpt.substring(0, 120).replace(/\s\S*$/, '').trim();
    }
    return parsed;
  } catch {
    return {};
  }
}

export async function generateKeyphrase(post) {
  const title = post.title?.rendered || '(no title)';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';

  const prompt = `You are an SEO expert. Generate a focus keyphrase for this WordPress post.

Title: "${title}"
Content snippet: ${content.substring(0, 600)}

Rules:
- 2-4 words, specific and relevant to the main topic
- Should be a phrase people actually search for
- Same language as the content
- Plain text only, no quotes

Respond with ONLY this JSON (no explanation, no markdown):
{"keyphrase": "your focus keyphrase"}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: 'You are an SEO assistant. Always respond with valid JSON only. Never add explanation or markdown formatting.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed.keyphrase || null;
  } catch {
    return null;
  }
}

export async function generateImageAltWithKeyphrase(images, postTitle, keyphrase) {
  const prompt = `You are an SEO expert. Improve the alt texts for images in a WordPress post so they naturally include words from the focus keyphrase.

Post title: "${postTitle}"
Focus keyphrase: "${keyphrase}"

Images:
${images.map((img, i) => `${i + 1}. ID: ${img.id}, Current alt: "${img.currentAlt || '(empty)'}", File: "${img.filename}"`).join('\n')}

Rules:
- Include 1-2 words from the keyphrase naturally in each alt text
- Alt text describes the image, not keyword stuffing
- 5-15 words per alt text
- Same language as the post title
- If current alt is good, still try to work in keyphrase words

Respond with ONLY this JSON array (no explanation, no markdown):
[{"id": 123, "alt": "improved alt text"}]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are an SEO assistant. Always respond with valid JSON only. Never add explanation or markdown formatting.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '[]';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function generateIntroFix(post, keyphrase) {
  const title = post.title?.rendered || '(no title)';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const firstPara = post.currentIntro || content.substring(0, 300);

  const prompt = `You are an SEO expert. Rewrite or create an introduction paragraph for this WordPress post that naturally includes the focus keyphrase.

Post title: "${title}"
Focus keyphrase: "${keyphrase}"
Current first paragraph: "${firstPara || '(empty)'}"

Rules:
- Include the focus keyphrase naturally in the first or second sentence
- Same language and tone as the existing content
- 40-80 words
- Plain text only, no HTML tags

Respond with ONLY this JSON (no explanation, no markdown):
{"intro": "your rewritten introduction paragraph"}`;

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
    return parsed.intro || null;
  } catch {
    return null;
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
