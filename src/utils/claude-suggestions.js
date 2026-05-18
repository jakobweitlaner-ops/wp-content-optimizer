import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Heuristic language detection — returns ISO 639-1 code ('de', 'fr', 'es', 'it', 'en', …)
// Requires BOTH common-word matches AND special-char matches so that place names
// (e.g. "Außervillgraten" with ü) in otherwise-English text don't trigger a false positive.
export function detectLanguage(text) {
  const sample = text.substring(0, 800).toLowerCase();
  const checks = [
    { lang: 'de', re: /\b(der|die|das|und|ist|nicht|mit|auf|für|von|zu|auch|als|bei|aus|nach|über|haben|sind|wird|kann|werden|sein|keine|dieser|unsere|wir|sie|ihr)\b/g, chars: /[äöüß]/g, wordThreshold: 4, charThreshold: 3 },
    { lang: 'fr', re: /\b(le|la|les|et|est|pas|avec|sur|pour|dans|qui|que|une|des|du|au|aux|nous|vous|ils|elle|sont|avoir|plus|par)\b/g, chars: /[éèêëàâùûîïœç]/g, wordThreshold: 4, charThreshold: 3 },
    { lang: 'es', re: /\b(el|la|los|las|y|es|no|con|por|para|en|que|una|del|al|su|se|un|son|hay|más|pero|como|este|esta)\b/g, chars: /[áéíóúüñ]/g, wordThreshold: 4, charThreshold: 2 },
    { lang: 'it', re: /\b(il|lo|la|i|gli|le|e|non|con|per|in|che|una|del|al|su|si|un|sono|più|ma|come|questo|questa)\b/g, chars: /[àèéìíîòóùú]/g, wordThreshold: 4, charThreshold: 2 },
  ];
  for (const { lang, re, chars, wordThreshold, charThreshold } of checks) {
    const words = (sample.match(re) || []).length;
    const charMatches = (sample.match(chars) || []).length;
    // Both conditions must be met to avoid false positives from proper nouns / place names
    if (words >= wordThreshold && charMatches >= charThreshold) return lang;
  }
  return 'en';
}

const LANG_NAMES = { de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', en: 'English' };

function langName(code) {
  return LANG_NAMES[code] || 'English';
}

export async function generateSeoFixes(post, issues, keyphrase = '') {
  const title = post.title?.rendered || '(no title)';
  const excerpt = post.excerpt?.rendered?.replace(/<[^>]+>/g, '').trim() || '';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const contentSnippet = content.substring(0, 400);
  const lang = langName(detectLanguage(title + ' ' + content));
  const keyphraseHint = keyphrase ? `\nFocus keyphrase: "${keyphrase}" — weave it naturally into the text; do NOT place it at the very beginning.` : '';

  const needsTitle = issues.some((i) => /title/i.test(i));
  const needsExcerpt = issues.some((i) => /excerpt|meta description/i.test(i));

  if (!needsTitle && !needsExcerpt) return {};

  let prompt;
  if (needsTitle && needsExcerpt) {
    prompt = `You are an SEO expert. Create an improved title and meta description for this WordPress page.

Language: ${lang} — write ONLY in ${lang}.
Current title: "${title}"
Content: ${contentSnippet}
Issues: ${issues.join('; ')}${keyphraseHint}

Rules:
- title: 20-60 characters, descriptive, keep the structural pattern of the current title (e.g. "Page | Brand") but write ALL words in ${lang} — translate any words from other languages
- excerpt: 120-140 characters, compelling summary

Respond with ONLY this JSON (no explanation, no markdown):
{"title": "your improved title", "excerpt": "your meta description"}`;
  } else if (needsTitle) {
    prompt = `You are an SEO expert. Create an improved SEO title for this WordPress page.

Language: ${lang} — write ONLY in ${lang}.
Current title: "${title}"
Content: ${contentSnippet}
Issue: ${issues.join('; ')}${keyphraseHint}

Rules:
- Must be 20-60 characters
- Descriptive and specific to the page content
- Keep the structural pattern of the current title (e.g. "Page | Brand") but write ALL words in ${lang} — translate any words from other languages; do NOT start with the keyphrase

Respond with ONLY this JSON (no explanation, no markdown):
{"title": "your improved title"}`;
  } else {
    prompt = `You are an SEO expert. Create a meta description for this WordPress page.

Language: ${lang} — write ONLY in ${lang}.
Title: "${title}"
Content: ${contentSnippet}
Issue: ${issues.join('; ')}${keyphraseHint}

Rules:
- Must be 120-140 characters
- Compelling summary of the page

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
    if (parsed.excerpt && parsed.excerpt.length > 140) {
      parsed.excerpt = parsed.excerpt.substring(0, 140).replace(/\s\S*$/, '').trim();
    }
    return parsed;
  } catch {
    return {};
  }
}

export async function generateKeyphrase(post) {
  const title = post.title?.rendered || '(no title)';
  const content = post.content?.rendered?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
  const lang = langName(detectLanguage(title + ' ' + content));

  const prompt = `You are an SEO expert. Generate a focus keyphrase for this WordPress post.

Language: ${lang} — write ONLY in ${lang}.
Title: "${title}"
Content snippet: ${content.substring(0, 600)}

Rules:
- 2-4 words, specific and relevant to the main topic
- Should be a phrase people actually search for
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
  const lang = langName(detectLanguage(postTitle + ' ' + keyphrase));

  const prompt = `You are an SEO expert. Improve the alt texts for images in a WordPress post so they naturally include words from the focus keyphrase.

Language: ${lang} — write ONLY in ${lang}.
Post title: "${postTitle}"
Focus keyphrase: "${keyphrase}"

Images:
${images.map((img, i) => `${i + 1}. ID: ${img.id}, Current alt: "${img.currentAlt || '(empty)'}", File: "${img.filename}"`).join('\n')}

Rules:
- Include 1-2 words from the keyphrase naturally in each alt text
- Alt text describes the image, not keyword stuffing
- 5-15 words per alt text
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
  const currentIntro = post.currentIntro || '';
  const lang = langName(detectLanguage(title + ' ' + content));

  // Send remaining body so the AI knows what's already covered and avoids repetition
  const bodySnippet = currentIntro
    ? content.replace(currentIntro, '').trim().substring(0, 600)
    : content.substring(0, 600);

  const introLine = currentIntro
    ? `Current first paragraph: "${currentIntro}"`
    : `Current first paragraph: (none — write a brand new introduction)`;

  const prompt = `You are an SEO expert. ${currentIntro ? 'Rewrite' : 'Write'} an introduction paragraph for this WordPress post that naturally includes the focus keyphrase.

Language: ${lang} — write ONLY in ${lang}.
Post title: "${title}"
Focus keyphrase: "${keyphrase}"
${introLine}
Rest of the page content: "${bodySnippet || '(none)'}"

Rules:
- Include the focus keyphrase naturally in the first or second sentence
- Match the tone of the existing content
- 40-80 words
- Plain text only, no HTML tags
- Do NOT repeat specific information or phrases already covered in the rest of the page content — the intro should lead into the content, not summarize it

Respond with ONLY this JSON (no explanation, no markdown):
{"intro": "your introduction paragraph"}`;

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
  const lang = langName(detectLanguage(title + ' ' + content));

  const prompt = `You are an SEO expert. Create an optimized H1 heading for this WordPress page.

Language: ${lang} — write ONLY in ${lang}.
Title: "${title}"
${currentH1 ? `Current H1: "${currentH1}"` : 'Current H1: (none)'}
Content snippet: ${content.substring(0, 600)}

Rules:
- Descriptive and contains the main keyword
- Should differ from the SEO title when possible (can be more natural/longer)
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
  const rendered = post.content?.rendered || '';
  const content = rendered.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = post._wordCount || 0;
  const lang = langName(detectLanguage(title + ' ' + content));

  // Extract standalone paragraph texts — skip UAGB/block-internal paragraphs
  const paraTexts = [];
  const paraRe = /<p(\s[^>]*)?>[\s\S]*?<\/p>/gi;
  let m;
  while ((m = paraRe.exec(rendered)) !== null) {
    const attrs = m[1] || '';
    if (/class="uagb-|class="wp-block-/.test(attrs)) continue;
    const text = m[0].replace(/<[^>]+>/g, '').trim();
    if (text.length > 30) paraTexts.push(text);
  }

  if (paraTexts.length === 0) return null;

  const prompt = `You are a content writer. Expand and enrich each of the following existing paragraphs from a WordPress post to increase the total word count.

Language: ${lang} — write ONLY in ${lang}.
Post title: "${title}"
Current word count: ${wordCount} words (target: 300+ words)

Paragraphs to expand (${paraTexts.length} total):
${paraTexts.map((p, i) => `${i + 1}. "${p}"`).join('\n')}

Rules:
- Rewrite each paragraph to be more detailed and informative (roughly 1.5–2× the original length)
- Keep the same topic, tone, and information — just add more depth and context
- Plain text only, no HTML tags
- Return exactly ${paraTexts.length} expanded paragraphs in the same order as the input

Respond with a JSON array containing exactly ${paraTexts.length} strings.`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: 'You are a content writer. Always respond with valid JSON only. Never add explanation or markdown formatting.',
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '[]';
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.filter(p => typeof p === 'string' && p.trim()).join('\n\n');
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
